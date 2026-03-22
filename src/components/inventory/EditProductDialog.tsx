
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
import { type InventoryItem, type Location } from '@/lib/data';
import { useToast } from '@/hooks/use-toast';
import { useForm, FormProvider, useFormContext, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { 
    Check, 
    PlusCircle, 
    AlertTriangle, 
    DollarSign, 
    Package, 
    Trash2, 
    ShoppingCart, 
    Calculator, 
    Sparkles,
    Truck,
    Clock,
    Pipette,
    CheckCircle,
    Calendar as CalendarIcon,
    ArrowRight,
    Edit,
    Coffee,
    FileText,
    Lock,
    User,
    Building
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, parseISO } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Calendar } from '../ui/calendar';
import { ScrollArea } from '../ui/scroll-area';
import { Switch } from '../ui/switch';

const editProductSchema = z.object({
  id: z.string(),
  name: z.string().min(1, 'Product name is required'),
  type: z.enum(['professional', 'retail', 'equipment', 'overhead', 'refreshment']),
  category: z.string().min(1, 'Category is required'),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
  internalNotes: z.string().optional(),
  isMembersOnly: z.boolean().default(false),
  showInConcierge: z.boolean().default(true),
  
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
  wholesalePrice: z.coerce.number().optional(),
  packagingCost: z.coerce.number().optional(),
  shippingCostToCustomer: z.coerce.number().optional(),

  supplier: z.string().optional(),
  sku: z.string().optional(),
  purchaseLink: z.string().optional(),
  reorderPoint: z.coerce.number().optional(),
  primaryLocationId: z.string().optional(),
  expirationDate: z.date().optional(),

  // Manufacturing & SOP
  manufacturerName: z.string().optional(),
  manufacturerContactName: z.string().optional(),
  manufacturerEmail: z.string().optional(),
  manufacturerPhone: z.string().optional(),
  manufacturingSop: z.string().optional(),
  labelTemplateUrl: z.string().optional(),
  moq: z.coerce.number().optional(),
  leadTimeDays: z.coerce.number().optional(),
});

type ProductFormData = z.infer<typeof editProductSchema>;

const SectionHeader = ({ icon: Icon, title, step }: { icon: any, title: string, step: number }) => (
    <div className="flex items-center gap-4 mb-6 text-left">
        <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shadow-inner border border-primary/20 shrink-0">
            <Icon className="w-5 h-5" />
        </div>
        <div className="space-y-0.5 text-left">
            <p className="text-[9px] font-black uppercase tracking-widest text-primary/60">Module {step}</p>
            <h3 className="text-xl font-black uppercase tracking-tighter text-slate-900">{title}</h3>
        </div>
    </div>
);

const Step1 = ({ categories, onNewCategory }: { categories: string[]; onNewCategory: (cat: string) => void }) => {
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
        <div className="space-y-10">
            <SectionHeader icon={Package} title="Identity & Classification" step={1} />
            <div className="space-y-6 text-left">
                <div className="space-y-2">
                    <Label htmlFor="name-edit" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Asset Label</Label>
                    <Input id="name-edit" {...register('name')} className="h-14 rounded-2xl border-2 font-black uppercase text-lg tracking-tight shadow-inner" />
                    {errors.name && <p className="text-xs font-bold text-destructive uppercase ml-1">{errors.name.message}</p>}
                </div>
                <div className="space-y-2">
                    <Label htmlFor="category-edit" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Department</Label>
                    {isAddingCategory ? (
                        <div className="flex gap-2 text-left">
                            <Input
                                placeholder="New category name..."
                                value={newCategoryName}
                                onChange={(e) => setNewCategoryName(e.target.value)}
                                className="h-12 rounded-xl border-2 font-bold uppercase text-xs"
                            />
                            <Button onClick={handleAddNewCategory} type="button" className="h-12 w-12 rounded-xl shadow-lg"><Check className="h-5 w-5" /></Button>
                        </div>
                    ) : (
                        <div className="flex gap-3">
                            <Controller name="category" control={control} render={({ field }) => (
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <SelectTrigger className="h-12 rounded-xl border-2 font-bold uppercase text-xs shadow-inner bg-muted/5">
                                        <SelectValue placeholder="Select a category" />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-xl border-2 shadow-2xl">
                                        {categories.map(cat => (<SelectItem key={cat} value={cat} className="font-bold uppercase text-[10px] tracking-widest">{cat}</SelectItem>))}
                                    </SelectContent>
                                </Select>
                            )}/>
                            <Button variant="outline" size="icon" onClick={() => setIsAddingCategory(true)} type="button" className="h-12 w-12 rounded-xl border-2"> <PlusCircle className="h-5 w-5" /> </Button>
                        </div>
                    )}
                    {errors.category && <p className="text-xs font-bold text-destructive uppercase ml-1">{errors.category.message}</p>}
                </div>
                
                <Controller
                    name="type"
                    control={control}
                    render={({ field }) => (
                        <div className="space-y-2 text-left">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Asset Role</Label>
                            <RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-3 gap-3">
                                <label htmlFor="professional-e" className="cursor-pointer">
                                    <div className={cn("flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all h-full text-center", field.value === 'professional' ? "border-primary bg-primary/5 shadow-lg" : "border-border bg-white")}>
                                        <Package className={cn("mb-1 h-5 w-5", field.value === 'professional' ? "text-primary" : "text-muted-foreground opacity-40")} />
                                        <span className="text-[9px] font-black uppercase">Professional</span>
                                        <RadioGroupItem value="professional" id="professional-e" className="sr-only" />
                                    </div>
                                </label>
                                <label htmlFor="retail-e" className="cursor-pointer">
                                    <div className={cn("flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all h-full text-center", field.value === 'retail' ? "border-primary bg-primary/5 shadow-lg" : "border-border bg-white")}>
                                        <ShoppingCart className={cn("mb-1 h-5 w-5", field.value === 'retail' ? "text-primary" : "text-muted-foreground opacity-40")} />
                                        <span className="text-[9px] font-black uppercase">Retail</span>
                                        <RadioGroupItem value="retail" id="retail-e" className="sr-only" />
                                    </div>
                                </label>
                                <label htmlFor="refreshment-e" className="cursor-pointer">
                                    <div className={cn("flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all h-full text-center", field.value === 'refreshment' ? "border-primary bg-primary/5 shadow-lg" : "border-border bg-white")}>
                                        <Coffee className={cn("mb-1 h-5 w-5", field.value === 'refreshment' ? "text-primary" : "text-muted-foreground opacity-40")} />
                                        <span className="text-[9px] font-black uppercase">Amenity</span>
                                        <RadioGroupItem value="refreshment" id="refreshment-e" className="sr-only" />
                                    </div>
                                </label>
                            </RadioGroup>
                        </div>
                    )}
                />

                {(productType === 'refreshment' || productType === 'professional') && (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between p-6 rounded-[2rem] border-2 border-indigo-500/20 bg-indigo-500/5 shadow-inner">
                            <div className="space-y-1 text-left">
                                <Label htmlFor="mem-only-edit" className="text-base font-black uppercase tracking-tight text-indigo-700 flex items-center gap-2 text-left">
                                    <Lock className="w-3 h-3" /> Members Only Access
                                </Label>
                                <p className="text-[10px] font-bold text-indigo-600/60 uppercase tracking-widest text-left">Restrict request availability to active members</p>
                            </div>
                            <Controller name="isMembersOnly" control={control} render={({ field }) => (
                                <Switch id="mem-only-edit" checked={field.value} onCheckedChange={field.onChange} className="scale-125 data-[state=checked]:bg-indigo-600" />
                            )}/>
                        </div>
                        {productType === 'refreshment' && (
                            <div className="flex items-center justify-between p-6 rounded-[2rem] border-2 border-primary/20 bg-primary/5 shadow-inner">
                                <div className="space-y-1 text-left">
                                    <Label htmlFor="concierge-toggle-edit" className="text-base font-black uppercase tracking-tight text-primary flex items-center gap-2">
                                        <Coffee className="w-4 h-4" /> Visible in Concierge
                                    </Label>
                                    <p className="text-[10px] font-bold text-primary/60 uppercase tracking-widest text-left">Display this item on the guest-facing menu</p>
                                </div>
                                <Controller name="showInConcierge" control={control} render={({ field }) => (
                                    <Switch id="concierge-toggle-edit" checked={field.value} onCheckedChange={field.onChange} className="scale-125" />
                                )}/>
                            </div>
                        )}
                    </div>
                )}

                <div className="space-y-2 text-left">
                    <Label htmlFor="description-edit" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Public Description</Label>
                    <Textarea id="description-edit" placeholder="Public flavor profiles, ingredients, or benefit context..." {...register('description')} className="rounded-2xl border-2 bg-muted/5 min-h-[100px] focus-visible:ring-primary/20 p-4 font-medium shadow-inner" />
                </div>

                <div className="space-y-2 text-left">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Dossier Visual</Label>
                    <Controller name="imageUrl" control={control} render={({ field }) => ( <ImageUpload onImageUploaded={field.onChange} initialImage={field.value} /> )}/>
                </div>
                <div className="space-y-2 text-left">
                    <Label htmlFor="notes-edit" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Internal Log</Label>
                    <Textarea id="notes-edit" {...register('internalNotes')} className="rounded-2xl border-2 bg-muted/5 min-h-[100px] focus-visible:ring-primary/20 p-4 font-medium" />
                </div>
            </div>
        </div>
    );
};

const Step2 = () => {
    const { control, watch, register } = useFormContext<ProductFormData>();
    const productType = watch('type');
    const costingMethod = watch('costingMethod');
    const [totalPurchaseCost, numUnits, shippingCost, taxCost, discounts, msrp, wholesalePrice, packagingCost, shippingCostToCustomer] = watch([
        'totalPurchaseCost', 'numUnits', 'shippingCost', 'taxCost', 'discounts', 'msrp', 'wholesalePrice', 'packagingCost', 'shippingCostToCustomer'
    ]);

    const landedCostPerItem = useMemo(() => {
        const safeParse = (val: any) => parseFloat(val) || 0;
        const total = safeParse(totalPurchaseCost) + safeParse(shippingCost) + safeParse(taxCost) - safeParse(discounts);
        const units = safeParse(numUnits);
        return units > 0 ? total / units : 0;
    }, [totalPurchaseCost, numUnits, shippingCost, taxCost, discounts]);

    return (
        <div className="space-y-10">
            <SectionHeader icon={Calculator} title="Yield & Pricing Model" step={2} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start text-left">
                <Card className="border-2 rounded-[2rem] overflow-hidden shadow-sm">
                    <CardHeader className="bg-muted/5 border-b p-6"><CardTitle className="text-sm font-black uppercase tracking-widest text-left">Base Economics</CardTitle></CardHeader>
                    <CardContent className="p-6 space-y-6">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5 text-left"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Invoice Amount</Label><Input type="number" {...register('totalPurchaseCost')} className="h-11 rounded-xl border-2 font-bold bg-white" /></div>
                            <div className="space-y-1.5 text-left"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Unit Qty</Label><Input type="number" {...register('numUnits')} className="h-11 rounded-xl border-2 font-bold bg-white" /></div>
                        </div>
                        <div className="p-5 rounded-2xl bg-primary/5 border-2 border-primary/10 flex justify-between items-center shadow-inner text-left">
                            <span className="text-[10px] font-black uppercase text-primary tracking-widest">Landed / Unit</span>
                            <span className="text-2xl font-black text-primary tracking-tighter font-mono">${landedCostPerItem.toFixed(2)}</span>
                        </div>
                    </CardContent>
                </Card>

                {productType === 'professional' || productType === 'overhead' || productType === 'refreshment' ? (
                    <Card className="border-2 rounded-[2rem] overflow-hidden shadow-sm">
                        <CardHeader className="bg-muted/5 border-b p-6"><CardTitle className="text-sm font-black uppercase tracking-widest text-left">Consumption Logic</CardTitle></CardHeader>
                        <CardContent className="p-6 space-y-6">
                            <Controller name="costingMethod" control={control} render={({ field }) => (
                                <RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 gap-2">
                                    <label htmlFor="size-e" className="cursor-pointer">
                                        <div className={cn("flex items-center justify-center gap-2 p-3 rounded-xl border-2 transition-all", field.value === 'size' ? "border-primary bg-primary/5 shadow-md" : "border-border bg-background hover:bg-muted/50")}>
                                            <Pipette className={cn("w-4 h-4", field.value === 'size' ? "text-primary" : "text-muted-foreground opacity-40")} />
                                            <span className="text-[10px] font-black uppercase tracking-widest">Volume</span>
                                            <RadioGroupItem value="size" id="size-e" className="sr-only" />
                                        </div>
                                    </label>
                                    <label htmlFor="uses-e" className="cursor-pointer">
                                        <div className={cn("flex items-center justify-center gap-2 p-3 rounded-xl border-2 transition-all", field.value === 'uses' ? "border-primary bg-primary/5 shadow-md" : "border-border bg-background hover:bg-muted/50")}>
                                            <CheckCircle className={cn("w-4 h-4", field.value === 'uses' ? "text-primary" : "text-muted-foreground opacity-40")} />
                                            <span className="text-[10px] font-black uppercase tracking-widest">Uses</span>
                                            <RadioGroupItem value="uses" id="uses-e" className="sr-only" />
                                        </div>
                                    </label>
                                </RadioGroup>
                            )}/>
                            {costingMethod === 'size' && (
                                <div className="grid grid-cols-2 gap-4 animate-in slide-in-from-top-2">
                                    <div className="space-y-1.5 text-left"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Size</Label><Input type="number" placeholder="1000" {...register('containerSize')} className="h-11 rounded-xl border-2 font-bold" /></div>
                                    <div className="space-y-1.5 text-left"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Unit</Label>
                                        <Controller name="containerUnit" control={control} render={({ field }) => (
                                            <Select onValueChange={field.onChange} value={field.value}>
                                                <SelectTrigger className="h-11 rounded-xl border-2 font-bold">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent className="rounded-xl">
                                                    <SelectItem value="ml" className="font-bold">ML</SelectItem>
                                                    <SelectItem value="oz" className="font-bold">OZ</SelectItem>
                                                    <SelectItem value="g" className="font-bold">G</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        )}/>
                                    </div>
                                </div>
                            )}
                            {costingMethod === 'uses' && (
                                <div className="space-y-1.5 animate-in slide-in-from-top-2 text-left">
                                    <Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Est. Uses / Container</Label>
                                    <Input type="number" placeholder="e.g., 50" {...register('usesPerContainer')} className="h-11 rounded-xl border-2 font-bold" />
                                </div>
                            )}
                            {productType === 'professional' && (
                                <div className="space-y-1.5 pt-2 border-t border-dashed border-border/50 text-left">
                                    <Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Restocking Markup (%)</Label>
                                    <Input type="number" placeholder="e.g., 5" {...register('restockingMarkup')} className="h-11 rounded-xl border-2 font-bold" />
                                </div>
                            )}
                        </CardContent>
                    </Card>
                ) : (
                    <Card className="border-2 rounded-[2rem] overflow-hidden shadow-sm">
                        <CardHeader className="bg-muted/5 border-b p-6"><CardTitle className="text-sm font-black uppercase tracking-widest text-left">Retail Profit Architecture</CardTitle></CardHeader>
                        <CardContent className="p-6 space-y-8">
                            <div className="p-5 rounded-2xl bg-muted/10 border-2 space-y-4">
                                <div className="flex justify-between items-center text-left"><span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Direct (MSRP)</span> <div className="relative w-32"><DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-primary"/><Input type="number" {...register('msrp')} className="h-10 pl-7 rounded-xl border-2 font-black text-primary font-mono text-lg shadow-inner bg-white"/></div></div>
                            </div>
                            <div className="p-5 rounded-2xl bg-muted/10 border-2 space-y-4">
                                <div className="flex justify-between items-center text-left"><span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Wholesale Rate</span> <div className="relative w-32"><DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400"/><Input type="number" {...register('wholesalePrice')} className="h-10 pl-7 rounded-xl border-2 font-black text-slate-700 font-mono text-lg shadow-inner bg-white"/></div></div>
                            </div>
                        </CardContent>
                    </Card>
                )}
            </div>
        </div>
    );
};

const Step3 = ({ locations, onAddLocationClick }: { locations: Location[], onAddLocationClick: () => void }) => {
    const { register, control, formState: { errors } } = useFormContext<ProductFormData>();
    return (
        <div className="space-y-10">
            <SectionHeader icon={Truck} title="Logistics & Continuity" step={3} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start text-left">
                <div className="space-y-8">
                    <Card className="border-2 rounded-[2rem] overflow-hidden shadow-sm">
                        <CardHeader className="bg-muted/5 border-b p-6 md:p-8"><CardTitle className="text-sm font-black uppercase tracking-widest text-left flex items-center gap-3"><Building className="w-4 h-4 text-primary" /> Manufacturing Vault</CardTitle></CardHeader>
                        <CardContent className="p-6 md:p-8 space-y-6 text-left">
                            <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Manufacturer Name</Label><Input placeholder="Global Formula Labs" {...register('manufacturerName')} className="h-11 rounded-xl border-2 font-bold" /></div>
                            <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Account Contact</Label><Input placeholder="Primary Rep Name" {...register('manufacturerContactName')} className="h-11 rounded-xl border-2 font-bold" /></div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Contact Email</Label><Input type="email" placeholder="rep@mfg.com" {...register('manufacturerEmail')} className="h-11 rounded-xl border-2 font-bold text-xs" /></div>
                                <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Contact Phone</Label><Input placeholder="555-000-0000" {...register('manufacturerPhone')} className="h-11 rounded-xl border-2 font-bold text-xs" /></div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="border-2 rounded-[2rem] overflow-hidden shadow-sm">
                        <CardHeader className="bg-muted/5 border-b p-6"><CardTitle className="text-sm font-black uppercase tracking-widest text-left flex items-center gap-3"><Landmark className="w-4 h-4 text-primary" /> Wholesale Matrix</CardTitle></CardHeader>
                        <CardContent className="p-6 space-y-5 text-left">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Min. Order (MOQ)</Label><Input type="number" placeholder="50" {...register('moq')} className="h-11 rounded-xl border-2 font-bold" /></div>
                                <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Lead Time (Days)</Label><Input type="number" placeholder="14" {...register('leadTimeDays')} className="h-11 rounded-xl border-2 font-bold" /></div>
                            </div>
                            <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Label Design Source (URL)</Label><Input placeholder="Cloud design link..." {...register('labelTemplateUrl')} className="h-11 rounded-xl border-2 font-bold text-xs" /></div>
                        </CardContent>
                    </Card>
                </div>

                <div className="space-y-8">
                    <Card className="border-2 rounded-[2rem] overflow-hidden shadow-sm">
                        <CardHeader className="bg-muted/5 border-b p-6 md:p-8"><CardTitle className="text-sm font-black uppercase tracking-widest text-left flex items-center gap-3"><FileText className="w-4 h-4 text-primary" /> Tech Protocol (SOP)</CardTitle></CardHeader>
                        <CardContent className="p-6 md:p-8">
                            <Textarea placeholder="Document the exact Standard Operating Procedure for this asset..." {...register('manufacturingSop')} className="rounded-xl border-2 bg-muted/5 min-h-[200px] focus-visible:ring-primary/20 font-medium" />
                        </CardContent>
                    </Card>

                    <Card className="border-2 rounded-[2rem] overflow-hidden shadow-sm">
                        <CardHeader className="bg-muted/5 border-b p-6"><CardTitle className="text-sm font-black uppercase tracking-widest text-left">Logistics Control</CardTitle></CardHeader>
                        <CardContent className="p-6 space-y-5 text-left">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1.5 text-left"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Asset SKU</Label><Input placeholder="Registry ID" {...register('sku')} className="h-11 rounded-xl border-2 font-mono font-black" /></div>
                                <div className="space-y-1.5 text-left"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Reorder Point</Label><Input type="number" {...register('reorderPoint')} className="h-11 rounded-xl border-2 font-black text-lg shadow-inner bg-white" /></div>
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Placement Zone</Label>
                                <div className="flex gap-2">
                                    <Controller name="primaryLocationId" control={control} render={({ field }) => (
                                        <Select onValueChange={field.onChange} value={field.value}>
                                            <SelectTrigger className="h-11 rounded-xl border-2 font-bold uppercase text-[10px] tracking-widest flex-1 bg-muted/5 shadow-inner">
                                                <SelectValue placeholder="Select Zone" />
                                            </SelectTrigger>
                                            <SelectContent className="rounded-xl border-2 shadow-2xl">
                                                {locations.map(loc => (<SelectItem key={loc.id} value={loc.id} className="font-bold uppercase text-[9px] tracking-widest">{loc.name}</SelectItem>))}
                                            </SelectContent>
                                        </Select>
                                    )}/>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    )
};

export const EditProductDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: InventoryItem;
  onProductUpdated: (product: InventoryItem) => void;
  categories: string[];
  onNewCategory: (category: string) => void;
  locations: Location[];
  onAddLocationClick: () => void;
}> = ({
  open, onOpenChange, product, onProductUpdated, categories, onNewCategory, locations, onAddLocationClick,
}) => {
  const [step, setStep] = useState(1);
  const totalSteps = 3;
  const isMobile = useIsMobile();
  const methods = useForm<ProductFormData>({ resolver: zodResolver(editProductSchema) });

  useEffect(() => {
    if (product && open) {
        const firstBatch = product.batches?.[0];
        methods.reset({ 
            ...product, 
            totalPurchaseCost: product.costPerUnit || 0, 
            numUnits: 1, 
            shippingCost: 0, 
            taxCost: 0, 
            discounts: 0, 
            containerSize: product.size, 
            containerUnit: product.unit, 
            usesPerContainer: product.estimatedUses, 
            purchaseLink: product.supplierUrl, 
            expirationDate: firstBatch?.expirationDate ? parseISO(firstBatch.expirationDate) : undefined,
            description: product.description || '',
            isMembersOnly: !!product.isMembersOnly,
            showInConcierge: !!product.showInConcierge,
            internalNotes: product.internalNotes || '',
            manufacturerName: product.manufacturerName || '',
            manufacturerContactName: product.manufacturerContactName || '',
            manufacturerEmail: product.manufacturerEmail || '',
            manufacturerPhone: product.manufacturerPhone || '',
            manufacturingSop: product.manufacturingSop || '',
            labelTemplateUrl: product.labelTemplateUrl || '',
            moq: product.moq || 0,
            leadTimeDays: product.leadTimeDays || 0,
        });
        setStep(1);
    }
  }, [product, open, methods]);

  const { handleSubmit, trigger } = methods;
  const onSubmit = (data: ProductFormData) => {
    const costPerUnit = (data.numUnits || 1) > 0 ? ((data.totalPurchaseCost || 0) + (data.shippingCost || 0) + (data.taxCost || 0) - (data.discounts || 0)) / (data.numUnits || 1) : product.costPerUnit;
    const updatedBatches = [...product.batches];
    if (updatedBatches.length > 0) updatedBatches[0] = { ...updatedBatches[0], costPerUnit, expirationDate: data.expirationDate?.toISOString() };
    
    onProductUpdated({ 
        ...product, 
        ...data, 
        costPerUnit, 
        batches: updatedBatches, 
        supplierUrl: data.purchaseLink 
    });
    onOpenChange(false);
  };

  const handleNext = async (e: any) => { e.preventDefault(); if (await trigger(step === 1 ? ['name', 'category'] : [])) setStep(step + 1); };
  const handleBack = (e: any) => { e.preventDefault(); setStep(step - 1); };

  const formBody = (
    <FormProvider {...methods}>
      <form id={`edit-product-form-${product.id}`} onSubmit={handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
        <DialogHeader className={cn("flex-shrink-0 text-left border-b bg-muted/5", isMobile ? "p-6" : "p-8 pb-6")}>
          <div className="flex items-center gap-3 mb-2">
            <Edit className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Strategic Refinement</span>
          </div>
          <DialogTitle className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">Modify Asset Record</DialogTitle>
          <DialogDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">Refining record ID: {product.id.slice(-6).toUpperCase()}</DialogDescription>
          <div className="pt-6"><Progress value={(step / totalSteps) * 100} className="h-1 rounded-full bg-muted" /></div>
        </DialogHeader>
        <ScrollArea className="flex-1">
            <div className={cn("pb-32", isMobile ? "p-6" : "p-8")}>
                {step === 1 && <Step1 categories={categories} onNewCategory={onNewCategory} />}
                {step === 2 && <Step2 />}
                {step === 3 && <Step3 locations={locations} onAddLocationClick={onAddLocationClick} />}
            </div>
        </ScrollArea>
        <DialogFooter className={cn("border-t bg-background flex-shrink-0 shadow-2xl", isMobile ? "p-4" : "p-6 sm:p-8 pt-4")}>
          <div className='flex w-full gap-4'>
            {step > 1 && <Button variant="ghost" onClick={handleBack} type="button" className="flex-1 h-12 md:h-16 rounded-3xl font-black uppercase tracking-tighter text-[10px] md:text-2xl text-slate-400">Back</Button>}
            <div className={cn("flex gap-3", step === 1 ? "w-full" : "flex-[2.5]")}>
              <Button variant="outline" onClick={() => onOpenChange(false)} type="button" className="flex-1 h-12 md:h-16 rounded-3xl font-black uppercase tracking-widest text-[10px] md:text-xl border-2">Cancel</Button>
              {step < totalSteps ? (
                <Button onClick={handleNext} type="button" className="flex-[1.5] h-12 md:h-16 font-black uppercase tracking-widest text-[10px] md:text-xl rounded-[2rem] shadow-2xl shadow-primary/30 group">Continue <ArrowRight className="ml-3 w-4 h-4 md:w-8 md:h-8 transition-transform group-hover:translate-x-1" /></Button>
              ) : (
                <Button type="submit" className="flex-[1.5] h-12 md:h-16 font-black uppercase tracking-widest text-[10px] md:text-xl rounded-[2rem] shadow-2xl shadow-primary/30">Commit Changes</Button>
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
      <DialogContent className={cn("p-0 border-none bg-background flex flex-col shadow-3xl overflow-hidden", isMobile ? "h-[92dvh] rounded-t-[2.5rem]" : "sm:max-w-5xl max-h-[90dvh]")} side="right">
        {formBody}
      </DialogContent>
    </DialogContainer>
  );
};
