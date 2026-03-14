
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ImageUpload } from '@/components/shared/ImageUpload';
import { type ConsentForm, type InventoryItem, type PricingTier, type Resource } from '@/lib/data';
import { useToast } from '@/hooks/use-toast';
import { Controller, FormProvider, useForm, useFormContext, type Control } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertTriangle, Calculator, Check, Clock, DollarSign, Hammer, Package, PlusCircle, QrCode, ShoppingCart, Trash2, TrendingUp, Sparkles, ArrowRight, ListChecks, Activity, ShieldCheck, Target, Percent } from 'lucide-react';
import { type Service } from '@/lib/data';
import { BrowseProductsDialog } from '../services/BrowseProductsDialog';
import { SelectResourcesDialog } from './SelectResourcesDialog';
import { SelectAddOnsDialog } from '../services/SelectAddOnsDialog';
import { BrowseConsentFormsDialog } from './BrowseConsentFormsDialog';
import { Switch } from '../ui/switch';
import { useInventory } from '@/context/InventoryContext';
import { cn } from '@/lib/utils';
import { ScrollArea } from '../ui/scroll-area';
import { useTenant } from '@/context/TenantContext';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where, doc } from 'firebase/firestore';
import { nanoid } from 'nanoid';

const serviceSchema = z.object({
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
  capacity: z.coerce.number().min(1).optional(),
  
  products: z.array(z.any()).optional(),
  requiredResourceIds: z.array(z.string()).optional(),
  compatibleAddOnIds: z.array(z.string()).optional(),
  
  depositType: z.enum(['none', 'deposit', 'full', 'breakeven']),
  depositSubType: z.enum(['flat', 'percentage']).optional(),
  depositAmount: z.coerce.number().optional(),
  
  price: z.coerce.number().optional(),
  serviceTiers: z.array(z.object({
      tierId: z.string(),
      price: z.coerce.number().min(0, "Price must be positive."),
      durationMinutes: z.coerce.number().min(1, "Duration must be at least 1."),
  })).optional(),

  confirmationMessage: z.string().optional(),
  requiredFormIds: z.array(z.string()).optional(),
}).superRefine((data, ctx) => {
    const hasTiers = data.serviceTiers && data.serviceTiers.length > 0;
    if (!hasTiers && (data.price === undefined || data.price < 0)) {
         ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A standard price is required when no tiers are used.", path: ["price"] });
    }
});

type ServiceFormData = z.infer<typeof serviceSchema>;

const SectionHeader = ({ icon: Icon, title, step }: { icon: any, title: string, step: number | string }) => (
    <div className="flex items-center gap-4 mb-6">
        <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shadow-inner border border-primary/20 shrink-0">
            <Icon className="w-5 h-5" />
        </div>
        <div className="space-y-0.5 text-left">
            <p className="text-[9px] font-black uppercase tracking-widest text-primary/60">Module {step}</p>
            <h3 className="text-xl font-black uppercase tracking-tighter text-slate-900">{title}</h3>
        </div>
    </div>
);

const Step1 = ({ 
    categories, 
    onNewCategory 
}: { 
    categories: string[];
    onNewCategory: (category: string) => void;
}) => {
    const { register, control, setValue, watch, formState: { errors } } = useFormContext<ServiceFormData>();
    const [isAddingCategory, setIsAddingCategory] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState('');

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
        <div className="space-y-10">
            <SectionHeader icon={Activity} title="Identity & Type" step={1} />
            <div className="space-y-6 text-left">
                <div className="flex items-center justify-between p-6 rounded-[2rem] border-2 bg-primary/[0.03] border-primary/10 shadow-sm transition-all has-[:checked]:bg-primary/5 has-[:checked]:border-primary/20">
                    <div className='space-y-1'>
                        <Label htmlFor="is-addon" className="text-base font-black uppercase tracking-tight">Add-on Enhancement</Label>
                        <p className='text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60'>Appendable to primary treatments</p>
                    </div>
                    <Controller name="isAddon" control={control} render={({ field }) => ( <Switch id="is-addon" checked={field.value} onCheckedChange={(checked) => { field.onChange(checked); setValue('type', checked ? 'addon' : 'service'); }} className="scale-125" /> )}/>
                </div>

                <div className="space-y-2">
                    <Label htmlFor="service-name" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Treatment Label</Label>
                    <Input id="service-name" placeholder="e.g., SIGNATURE BLOWOUT" {...register('name')} className="h-14 rounded-2xl border-2 font-black uppercase text-lg tracking-tight" />
                    {errors.name && <p className="text-[10px] font-black text-destructive uppercase ml-1">{errors.name.message}</p>}
                </div>

                <div className="space-y-2">
                    <Label htmlFor="category" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Library Department</Label>
                    {isAddingCategory ? (
                        <div className="flex gap-2">
                            <Input placeholder="NEW CATEGORY..." value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAddNewCategory()} className="h-12 rounded-xl border-2 font-black uppercase text-xs" />
                            <Button onClick={handleAddNewCategory} type="button" className="h-12 w-12 rounded-xl shadow-lg"><Check className="h-5 w-5" /></Button>
                        </div>
                    ) : (
                        <div className="flex gap-2">
                            <Controller name="category" control={control} render={({ field }) => (
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <SelectTrigger className="h-12 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest shadow-inner bg-muted/5"> <SelectValue placeholder="SELECT DEPARTMENT" /> </SelectTrigger>
                                    <SelectContent className="rounded-xl border-2 shadow-2xl"> {categories.map(cat => ( <SelectItem key={cat} value={cat} className="font-bold uppercase text-[10px] tracking-widest">{cat}</SelectItem> ))} </SelectContent>
                                </Select>
                            )}/>
                            <Button variant="outline" size="icon" onClick={() => setIsAddingCategory(true)} type="button" className="h-12 w-12 rounded-xl border-2"> <PlusCircle className="h-5 w-5" /> </Button>
                        </div>
                    )}
                    {errors.category && <p className="text-[10px] font-black text-destructive uppercase ml-1">{errors.category.message}</p>}
                </div>

                <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2 text-center">
                        <Label htmlFor="duration" className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Action (m)</Label>
                        <Input id="duration" type="number" placeholder="60" {...register('duration')} className="h-14 rounded-2xl border-2 font-black text-center text-xl shadow-inner bg-muted/5" />
                    </div>
                    <div className="space-y-2 text-center">
                        <Label htmlFor="pad-before" className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Pre-Pad</Label>
                        <Input id="pad-before" type="number" placeholder="0" {...register('padBefore')} className="h-14 rounded-2xl border-2 font-black text-center text-xl shadow-inner bg-muted/5" />
                    </div>
                    <div className="space-y-2 text-center">
                        <Label htmlFor="pad-after" className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Post-Pad</Label>
                        <Input id="pad-after" type="number" placeholder="15" {...register('padAfter')} className="h-14 rounded-2xl border-2 font-black text-center text-xl shadow-inner bg-muted/5" />
                    </div>
                </div>
                {errors.duration && <p className="text-[10px] font-black text-destructive uppercase text-center">{errors.duration.message}</p>}

                <div className="space-y-2 text-left">
                    <Label htmlFor="description" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Clinical Description</Label>
                    <Textarea id="description" placeholder="Describe the service objectives..." {...register('description')} className="rounded-2xl border-2 bg-muted/5 min-h-[100px] focus-visible:ring-primary/20" />
                </div>

                <div className="space-y-2 text-left">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Menu Visual</Label>
                    <Controller name="imageUrl" control={control} render={({ field }) => ( <ImageUpload onImageUploaded={field.onChange} /> )}/>
                </div>
            </div>
        </div>
    );
};

const Step2 = ({ resources, allServices }: { resources: Resource[], allServices: Service[] }) => {
    const { inventory } = useInventory();
    const { setValue, watch } = useFormContext<ServiceFormData>();

    const selectedProducts = watch('products') || [];
    const selectedResourceIds = watch('requiredResourceIds') || [];
    const compatibleAddOnIds = watch('compatibleAddOnIds') || [];
    const isAddon = watch('isAddon');
    
    const [isProductBrowserOpen, setIsProductBrowserOpen] = useState(false);
    const [isResourceSelectorOpen, setIsResourceSelectorOpen] = useState(false);
    const [isAddOnSelectorOpen, setIsAddOnSelectorOpen] = useState(false);

    const selectedResources = useMemo(() => {
        return resources.filter(r => selectedResourceIds.includes(r.id));
    }, [resources, selectedResourceIds]);

    const handleProductSelect = (products: InventoryItem[]) => {
      const productsWithQuantity = products.map(p => {
        const existing = selectedProducts.find((sp: any) => sp.id === p.id);
        return {
            id: p.id,
            name: p.name,
            costPerUnit: p.costPerUnit,
            unit: p.unit,
            useUnit: p.useUnit,
            costingMethod: p.costingMethod,
            size: p.size,
            estimatedUses: p.estimatedUses,
            quantityUsed: existing?.quantityUsed || 1,
        };
      });
      setValue('products', productsWithQuantity, { shouldDirty: true });
      setIsProductBrowserOpen(false);
    };
    
    const handleResourceSelect = (resources: Resource[]) => {
        setValue('requiredResourceIds', resources.map(r => r.id), { shouldDirty: true });
        setIsResourceSelectorOpen(false);
    };
    
    const handleAddOnSelect = (addOns: Service[]) => {
        setValue('compatibleAddOnIds', addOns.map(a => a.id), { shouldDirty: true });
    };

    const removeProduct = (productId: string) => {
      setValue('products', selectedProducts.filter((p: any) => p.id !== productId), { shouldDirty: true });
    };

    const removeResource = (resourceId: string) => {
        setValue('requiredResourceIds', selectedResourceIds.filter((id: string) => id !== resourceId), { shouldDirty: true });
    };
    
    const removeAddOn = (addOnId: string) => {
        setValue('compatibleAddOnIds', compatibleAddOnIds.filter((id: string) => id !== addOnId), { shouldDirty: true });
    };

    const selectedAddOns = allServices.filter(s => compatibleAddOnIds.includes(s.id));

    return (
        <div className="space-y-10">
            <SectionHeader icon={Calculator} title="Formula & Resources" step={2} />
            <div className="space-y-8">
                <div className="space-y-4">
                    <div className='flex items-center justify-between px-1'>
                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                            <Package className="w-3.5 h-3.5 opacity-40" /> Product Consumption
                        </Label>
                        <Button variant="ghost" size="sm" onClick={() => setIsProductBrowserOpen(true)} className="h-7 px-3 text-[9px] font-black uppercase tracking-widest text-primary border border-primary/20 rounded-lg hover:bg-primary/5 shadow-sm">
                            <PlusCircle className="w-3 h-3 mr-1.5" /> Append Inventory
                        </Button>
                    </div>
                    {selectedProducts.length > 0 ? (
                        <div className="space-y-2">
                            {selectedProducts.map((product: any, index: number) => {
                                const inventoryItem = inventory.find(i => i.id === product.id);
                                const unit = inventoryItem?.costingMethod === 'uses' ? (inventoryItem.useUnit || 'uses') : (inventoryItem?.unit || 'ml');
                                return (
                                    <div key={product.id} className="flex items-center justify-between p-4 rounded-2xl border-2 bg-white shadow-sm gap-4 group">
                                        <span className="text-[11px] font-black uppercase tracking-tight text-slate-900 truncate flex-1 text-left">{product.name}</span>
                                        <div className="flex items-center gap-3">
                                            <div className="flex items-center gap-2">
                                                <Label className="text-[8px] font-black uppercase text-muted-foreground opacity-40">Load</Label>
                                                <Input 
                                                    type="number" 
                                                    value={product.quantityUsed || ''} 
                                                    onChange={(e) => {
                                                        const newQty = parseFloat(e.target.value) || 0;
                                                        const next = [...selectedProducts];
                                                        next[index] = { ...product, quantityUsed: newQty };
                                                        setValue('products', next, { shouldDirty: true });
                                                    }}
                                                    className="w-16 h-9 rounded-lg border-2 text-center font-black font-mono" 
                                                    step="0.1" 
                                                />
                                                <span className="text-[9px] font-black uppercase text-muted-foreground w-8 opacity-60">{unit}</span>
                                            </div>
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => removeProduct(product.id)}><Trash2 className="w-4 h-4" /></Button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="p-12 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4">
                            <Box className="w-12 h-12" />
                            <p className="text-[10px] font-black uppercase tracking-widest text-left">No Products in Formula</p>
                        </div>
                    )}
                </div>

                <div className="space-y-4">
                    <div className='flex items-center justify-between px-1'>
                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                            <Hammer className="w-3.5 h-3.5 opacity-40" /> Logistics (Rooms/Equipment)
                        </Label>
                        <Button variant="ghost" size="sm" onClick={() => setIsResourceSelectorOpen(true)} className="h-7 px-3 text-[9px] font-black uppercase tracking-widest text-primary border border-primary/20 rounded-lg hover:bg-primary/5 shadow-sm">
                            <PlusCircle className="w-3 h-3 mr-1.5" /> Select Unit
                        </Button>
                    </div>
                    {selectedResources.length > 0 ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
                            {selectedResources.map((item: any) => (
                                <div key={item.id} className="flex items-center justify-between p-4 rounded-2xl border-2 bg-white shadow-sm group">
                                    <span className="text-[10px] font-black uppercase tracking-tight text-slate-900 truncate">{item.name}</span>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => removeResource(item.id)}><Trash2 className="w-4 h-4" /></Button>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="p-12 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4">
                            <MapPin className="w-12 h-12" />
                            <p className="text-[10px] font-black uppercase tracking-widest">No Unit Required</p>
                        </div>
                    )}
                </div>

                {!isAddon && (
                    <div className="space-y-4">
                        <div className='flex items-center justify-between px-1 text-left'>
                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                <PlusCircle className="w-3.5 h-3.5 opacity-40" /> Enhancement Compatibility
                            </Label>
                            <Button variant="ghost" size="sm" onClick={() => setIsAddOnSelectorOpen(true)} className="h-7 px-3 text-[9px] font-black uppercase tracking-widest text-primary border border-primary/20 rounded-lg hover:bg-primary/5 shadow-sm">
                                <PlusCircle className="w-3 h-3 mr-1.5" /> Define Add-ons
                            </Button>
                        </div>
                        {selectedAddOns.length > 0 ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
                                {selectedAddOns.map((item: any) => (
                                    <div key={item.id} className="flex items-center justify-between p-4 rounded-2xl border-2 bg-white shadow-sm group">
                                        <span className="text-[10px] font-black uppercase tracking-tight text-slate-900 truncate">{item.name}</span>
                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => removeAddOn(item.id)}><Trash2 className="w-4 h-4" /></Button>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="p-12 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4">
                                <PlusCircle className="w-12 h-12" />
                                <p className="text-[10px] font-black uppercase tracking-widest">Standard Session (No Add-ons)</p>
                            </div>
                        )}
                    </div>
                )}
            </div>
            <BrowseProductsDialog open={isProductBrowserOpen} onOpenChange={setIsProductBrowserOpen} onSelect={handleProductSelect} allProducts={inventory.filter(i => i.type === 'professional')} initialSelected={selectedProducts as InventoryItem[]} />
            <SelectResourcesDialog open={isResourceSelectorOpen} onOpenChange={setIsResourceSelectorOpen} onSelect={handleResourceSelect} allResources={resources} initialSelected={selectedResources} />
            <SelectAddOnsDialog open={isAddOnSelectorOpen} onOpenChange={setIsAddOnSelectorOpen} onSelect={handleAddOnSelect} allAddOns={allServices.filter(s => s.type === 'addon')} initialSelected={selectedAddOns as Service[]} />
        </div>
    );
};

const PricingTierInput = ({ tier, control }: { tier: PricingTier, control: Control<ServiceFormData> }) => {
    const { watch, setValue, formState: { errors } } = useFormContext<ServiceFormData>();
    const serviceTiers = watch('serviceTiers') || [];
    const tierData = serviceTiers.find(t => t.tierId === tier.id);
    const isEnabled = !!tierData;

    const handleToggle = (checked: boolean) => {
        let next = [...serviceTiers];
        if (checked) {
            if (!next.find(t => t.tierId === tier.id)) {
                next.push({ tierId: tier.id, price: 0, durationMinutes: watch('duration') || 60 });
            }
        } else {
            next = next.filter(t => t.tierId !== tier.id);
        }
        setValue('serviceTiers', next, { shouldDirty: true });
    };

    const handleFieldChange = (field: 'price' | 'durationMinutes', value: number) => {
        const next = serviceTiers.map(t => t.tierId === tier.id ? {...t, [field]: value} : t);
        setValue('serviceTiers', next, { shouldDirty: true });
    };

    return (
        <Card className={cn("transition-all border-2 rounded-[1.5rem] overflow-hidden", isEnabled ? "border-primary bg-primary/[0.02]" : "opacity-60 bg-muted/10")}>
            <CardHeader className="p-4 border-b flex flex-row items-center justify-between bg-muted/5">
                <CardTitle className="text-xs font-black uppercase tracking-widest">{tier.name}</CardTitle>
                <Switch checked={isEnabled} onCheckedChange={handleToggle} />
            </CardHeader>
            {isEnabled && (
                <CardContent className="p-4 grid grid-cols-2 gap-3 text-left">
                    <div className="space-y-1">
                        <Label className="text-[8px] font-black uppercase text-muted-foreground opacity-60">Tier Price</Label>
                        <div className="relative"><DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-primary"/><Input type="number" step="0.01" value={tierData?.price || ''} onChange={e => handleFieldChange('price', parseFloat(e.target.value) || 0)} className="h-9 pl-6 rounded-lg border-2 font-black font-mono text-xs" /></div>
                    </div>
                    <div className="space-y-1">
                        <Label className="text-[8px] font-black uppercase text-muted-foreground opacity-60">Duration</Label>
                        <div className="relative"><Input type="number" value={tierData?.durationMinutes || ''} onChange={e => handleFieldChange('durationMinutes', parseInt(e.target.value) || 0)} className="h-9 pr-6 rounded-lg border-2 font-black font-mono text-xs text-center" /><span className="absolute right-2 top-1/2 -translate-y-1/2 text-[8px] font-black text-muted-foreground">M</span></div>
                    </div>
                </CardContent>
            )}
        </Card>
    );
};

const Step3 = ({ breakEvenCost, pricingTiers }: { breakEvenCost: number, pricingTiers: PricingTier[] }) => {
    const { control, watch, register, setValue, formState: { errors } } = useFormContext<ServiceFormData>();
    const depositType = watch('depositType');

    useEffect(() => {
        if (depositType === 'breakeven') {
            setValue('depositAmount', Number(breakEvenCost.toFixed(2)), { shouldValidate: true });
            setValue('depositSubType', 'flat', { shouldValidate: true });
        }
    }, [depositType, breakEvenCost, setValue]);

    return (
        <div className="space-y-10">
            <SectionHeader icon={DollarSign} title="Yield & Logic" step={3} />
            <div className="space-y-8 text-left">
                <Card className="border-4 border-primary/20 bg-primary/5 rounded-[2.5rem] shadow-2xl shadow-primary/5 overflow-hidden">
                    <CardHeader className="p-8 pb-4 border-b bg-white/50 backdrop-blur-sm">
                        <div className="flex justify-between items-center">
                            <div className="space-y-1 text-left">
                                <CardTitle className="text-lg font-black uppercase tracking-tight">Standard Unit Price</CardTitle>
                                <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60">Base retail rate for this session.</CardDescription>
                            </div>
                            <div className="text-right">
                                <p className="text-[9px] font-black uppercase tracking-widest text-destructive">Est. Breakeven</p>
                                <p className="text-2xl font-black text-destructive tracking-tighter font-mono">${breakEvenCost.toFixed(2)}</p>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="p-8">
                        <div className="relative">
                            <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 h-8 w-8 text-primary opacity-40" />
                            <Input id="standard-price" type="number" step="0.01" placeholder="0.00" {...register('price')} className="h-20 pl-14 rounded-3xl border-2 font-black text-4xl tracking-tighter text-primary shadow-inner bg-white focus-visible:ring-primary/20" />
                        </div>
                        {errors.price && <p className="text-[10px] font-black text-destructive uppercase ml-2 mt-2">{errors.price.message}</p>}
                    </CardContent>
                </Card>

                {pricingTiers.length > 0 && (
                    <div className="space-y-4">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Skill Tier Variances</Label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {pricingTiers.sort((a,b) => a.rank - b.rank).map(tier => <PricingTierInput key={tier.id} tier={tier} control={control} />)}
                        </div>
                    </div>
                )}
                
                <div className="space-y-4 pt-6 border-t border-dashed">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Booking Deposit Logic</Label>
                    <Controller name="depositType" control={control} defaultValue="none" render={({ field }) => (
                        <RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {['none', 'deposit', 'breakeven', 'full'].map(t => (
                                <label key={t} htmlFor={`dep-${t}`} className="cursor-pointer">
                                    <div className={cn(
                                        "flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all text-center h-full",
                                        field.value === t ? "border-primary bg-primary/5 shadow-lg" : "border-border bg-background hover:border-primary/20"
                                    )}>
                                        <span className="text-[10px] font-black uppercase tracking-widest">{t.replace('breakeven', 'Overhead')}</span>
                                        {t === 'breakeven' && <span className="text-[8px] font-bold opacity-60 mt-1">${breakEvenCost.toFixed(2)}</span>}
                                        <RadioGroupItem value={t} id={`dep-${t}`} className="sr-only" />
                                    </div>
                                </label>
                            ))}
                        </RadioGroup>
                    )}/>
                    <AnimatePresence>
                        {['deposit', 'breakeven'].includes(depositType!) && (
                            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                                <Card className="bg-muted/10 border-2 rounded-[2rem] shadow-inner mt-2">
                                    <CardContent className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
                                        {depositType === 'deposit' && (
                                            <div className="space-y-2 text-left">
                                                <Label className="text-[10px] font-black uppercase tracking-widest ml-1">Calculation</Label>
                                                <Controller name="depositSubType" control={control} render={({ field }) => (
                                                    <Select onValueChange={field.onChange} value={field.value}>
                                                        <SelectTrigger className="h-12 rounded-xl border-2 font-bold"><SelectValue /></SelectTrigger>
                                                        <SelectContent className="rounded-xl border-2 shadow-2xl"><SelectItem value="flat" className="font-bold">FLAT RATE</SelectItem><SelectItem value="percentage" className="font-bold">PERCENTAGE</SelectItem></SelectContent>
                                                    </Select>
                                                )}/>
                                            </div>
                                        )}
                                        <div className="space-y-2 text-left">
                                            <Label className="text-[10px] font-black uppercase tracking-widest ml-1">Allotment</Label>
                                            <Controller name="depositAmount" control={control} render={({ field }) => (
                                                <div className="relative">
                                                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary" />
                                                    <Input type="number" step="0.01" placeholder="25.00" {...field} value={field.value ?? ''} className="h-12 pl-8 rounded-xl border-2 font-black text-lg shadow-inner bg-white" disabled={depositType === 'breakeven'}/>
                                                </div>
                                            )} />
                                        </div>
                                    </CardContent>
                                </Card>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>
        </div>
    );
};

const Step4 = ({ consentForms }: { consentForms: ConsentForm[] }) => {
    const { register, control, setValue, watch } = useFormContext<ServiceFormData>();
    const requiredFormIds = watch('requiredFormIds') || [];
    const [isConsentFormBrowserOpen, setIsConsentFormBrowserOpen] = useState(false);
    
    const requiredForms = consentForms?.filter(f => requiredFormIds.includes(f.id)) || [];

    const handleRemoveForm = (formId: string) => {
        setValue('requiredFormIds', requiredFormIds.filter(id => id !== formId), { shouldDirty: true });
    };

    return (
        <div className="space-y-10">
            <SectionHeader icon={ShieldCheck} title="Logistics & Compliance" step={4} />
            <div className="space-y-8 text-left">
                <div className="space-y-2">
                    <Label htmlFor="confirmationMessage" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Guest Confirmation Message</Label>
                    <Textarea id="confirmationMessage" placeholder="Specific post-booking instructions..." {...register('confirmationMessage')} className="rounded-2xl border-2 bg-muted/5 focus-visible:ring-primary/20" />
                </div>
                
                <div className="flex items-center justify-between p-6 border-2 border-dashed rounded-[2rem] bg-muted/5 shadow-inner">
                    <div className='space-y-1'>
                        <Label htmlFor="private-service" className="text-base font-black uppercase tracking-tight">Private Listing</Label>
                        <p className='text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60'>Hide from the public booking directory</p>
                    </div>
                    <Controller name="isPrivate" control={control} render={({ field }) => ( <Switch id="private-service" checked={field.value} onCheckedChange={field.onChange} className="scale-125" /> )}/>
                </div>

                <div className="space-y-4">
                    <div className='flex items-center justify-between px-1'>
                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                            <ListChecks className="w-3.5 h-3.5 opacity-40" /> Required Agreements
                        </Label>
                        <Button variant="ghost" size="sm" onClick={() => setIsConsentFormBrowserOpen(true)} className="h-7 px-3 text-[9px] font-black uppercase tracking-widest text-primary border border-primary/20 rounded-lg hover:bg-primary/5 shadow-sm">
                            <PlusCircle className="w-3 h-3 mr-1.5" /> Browse Library
                        </Button>
                    </div>
                    {requiredForms.length > 0 ? (
                        <div className="grid grid-cols-1 gap-2">
                            {requiredForms.map(form => (
                                <div key={form.id} className="flex items-center justify-between p-4 rounded-2xl border-2 bg-white shadow-sm group">
                                    <span className="text-[10px] font-black uppercase tracking-tight text-slate-900 truncate">{form.title}</span>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => handleRemoveForm(form.id)}><Trash2 className="w-4 h-4" /></Button>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="p-12 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4">
                            <FileText className="w-12 h-12" />
                            <p className="text-[10px] font-black uppercase tracking-widest">No Legal Requirements</p>
                        </div>
                    )}
                </div>
            </div>
            <BrowseConsentFormsDialog open={isConsentFormBrowserOpen} onOpenChange={setIsConsentFormBrowserOpen} onSelect={(forms) => { setValue('requiredFormIds', forms.map(f => f.id), { shouldDirty: true }); }} allForms={consentForms || []} initialSelected={requiredForms} />
        </div>
    );
};


export const AddServiceDialog: React.FC<any> = ({
  open, onOpenChange, initialType, categories, onNewCategory, onServiceAdded, resources, services,
}) => {
  const [step, setStep] = useState(1);
  const totalSteps = 4;
  const isMobile = useIsMobile();
  const { inventory } = useInventory();
  const { selectedTenant } = useTenant();
  const { firestore } = useFirebase();
  const tmhr = selectedTenant?.tmhr || 50;
  const tenantId = selectedTenant?.id;
  
  const methods = useForm<ServiceFormData>({
    resolver: zodResolver(serviceSchema),
    defaultValues: { isAddon: initialType === 'addon', type: initialType === 'addon' ? 'addon' : 'service', capacity: 1, products: [], requiredResourceIds: [], compatibleAddOnIds: [], depositType: 'none', serviceTiers: [], requiredFormIds: [], price: 0 }
  });

  const { watch, trigger, handleSubmit, reset } = methods;
  const values = watch();

  useEffect(() => { if (open) { reset({ isAddon: initialType === 'addon', type: initialType === 'addon' ? 'addon' : 'service', capacity: 1, products: [], requiredResourceIds: [], compatibleAddOnIds: [], depositType: 'none', serviceTiers: [], requiredFormIds: [], price: 0 }); setStep(1); } }, [open, initialType, reset]);

  const { data: consentForms } = useCollection<ConsentForm>(useMemoFirebase(() => !firestore || !selectedTenant ? null : collection(firestore, `tenants/${selectedTenant.id}/consentForms`), [firestore, selectedTenant]));
  const { data: pricingTiersData } = useCollection<PricingTier>(useMemoFirebase(() => !firestore || !selectedTenant ? null : collection(firestore, `tenants/${selectedTenant.id}/pricingTiers`), [firestore, selectedTenant]));

  const breakEvenCost = useMemo(() => {
      const totalDur = (values.duration || 0) + (values.padBefore || 0) + (values.padAfter || 0);
      const productCost = (values.products || []).reduce((acc: number, p: any) => {
          const product = inventory.find(i => i.id === p.id);
          let cpu = 0;
          if (product) {
              if (product.costingMethod === 'size' && product.size) cpu = (product.costPerUnit || 0) / product.size;
              else if (product.costingMethod === 'uses' && product.estimatedUses) cpu = (product.costPerUnit || 0) / product.estimatedUses;
              else cpu = product.costPerUnit || 0;
          }
          return acc + (cpu * (p.quantityUsed || 1));
      }, 0);
      return (totalDur / 60) * tmhr + productCost;
  }, [values.duration, values.padBefore, values.padAfter, values.products, tmhr, inventory]);

  const onSubmit = (data: ServiceFormData) => {
      let finalPrice = data.price || 0;
      if (pricingTiersData?.length && data.serviceTiers?.length) {
          const senior = pricingTiersData.find(t => t.name.toLowerCase() === 'senior');
          finalPrice = data.serviceTiers.find(t => t.tierId === senior?.id)?.price || data.serviceTiers[0].price;
      }
      onServiceAdded({
        id: `svc-${nanoid()}`, ...data, type: data.isAddon ? 'addon' : 'service', price: finalPrice, cost: breakEvenCost, profit: finalPrice - breakEvenCost, margin: finalPrice > 0 ? ((finalPrice - breakEvenCost) / finalPrice) * 100 : 0
      });
      onOpenChange(false);
  };
  
  const handleNext = async (e: any) => {
      e.preventDefault();
      if (await trigger(step === 1 ? ['name', 'category', 'duration'] : step === 3 ? (pricingTiersData?.length ? ['serviceTiers'] : ['price']) : [])) setStep(step + 1);
  };

  const formBody = (
     <FormProvider {...methods}>
      <form id="add-service-wizard-form" onSubmit={handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
        <DialogHeader className={cn("flex-shrink-0 text-left border-b bg-muted/5", isMobile ? "p-6" : "p-8 pb-6")}>
          <div className="flex items-center gap-3 mb-2">
            <PlusCircle className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Strategic Intake</span>
          </div>
          <DialogTitle className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">Register New Service</DialogTitle>
          <DialogDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">Populate the treatment library with yield-aware logic.</DialogDescription>
          <div className="pt-6"><Progress value={(step / totalSteps) * 100} className="h-1 rounded-full bg-muted" /></div>
        </DialogHeader>
        <ScrollArea className="flex-1">
            <div className={cn("pb-32", isMobile ? "p-6" : "p-8")}>
                {step === 1 && <Step1 categories={categories} onNewCategory={onNewCategory} />}
                {step === 2 && <Step2 resources={resources} allServices={services} />}
                {step === 3 && <Step3 breakEvenCost={breakEvenCost} pricingTiers={pricingTiersData || []} />}
                {step === 4 && <Step4 consentForms={consentForms || []} />}
            </div>
        </ScrollArea>
        <DialogFooter className={cn("border-t bg-background flex-shrink-0 shadow-2xl", isMobile ? "p-4" : "p-6 sm:p-8 pt-4")}>
          <div className='flex w-full gap-4'>
            {step > 1 && <Button variant="ghost" onClick={() => setStep(step - 1)} type="button" className="flex-1 h-12 md:h-16 rounded-3xl font-black uppercase tracking-tighter text-[10px] md:text-2xl text-slate-400">Back</Button>}
            <div className={cn("flex gap-3", step === 1 ? "w-full" : "flex-[2.5]")}>
              <Button variant="outline" onClick={() => onOpenChange(false)} type="button" className="flex-1 h-12 md:h-16 rounded-3xl font-black uppercase tracking-widest text-[10px] md:text-xl border-2">Cancel</Button>
              {step < totalSteps ? (
                <Button onClick={handleNext} type="button" className="flex-[1.5] h-12 md:h-16 font-black uppercase tracking-widest text-[10px] md:text-xl rounded-[2rem] shadow-2xl shadow-primary/30 group">Continue <ArrowRight className="ml-3 w-4 h-4 md:w-8 md:h-8 transition-transform group-hover:translate-x-1" /></Button>
              ) : (
                <Button type="submit" className="flex-[1.5] h-12 md:h-16 font-black uppercase tracking-widest text-[10px] md:text-xl rounded-[2rem] shadow-2xl shadow-primary/30">Save Service</Button>
              )}
            </div>
          </div>
        </DialogFooter>
      </form>
    </FormProvider>
  );

  const DialogContainer = isMobile ? Sheet : Dialog;
  return (
    <DialogContainer open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("p-0 border-none bg-background flex flex-col shadow-3xl overflow-hidden", isMobile ? "h-[92dvh] rounded-t-[2.5rem]" : "sm:max-w-4xl max-h-[90dvh]")} side="right">
        {formBody}
      </DialogContent>
    </DialogContainer>
  );
};
