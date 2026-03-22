
'use client';

import React, { useState, useEffect, useMemo } from 'react';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
    ShoppingCart, 
    Calculator, 
    Sparkles,
    Truck,
    Clock,
    Tag,
    ChevronLeft,
    ChevronRight,
    MapPin,
    Calendar as CalendarIcon,
    Pipette,
    CheckCircle,
    ArrowRight,
    User,
    ShieldCheck,
    Building,
    Mail,
    Phone,
    Link as LinkIcon,
    FileText,
    Landmark
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Calendar } from '../ui/calendar';
import { ScrollArea } from '../ui/scroll-area';
import { nanoid } from 'nanoid';

const productSchema = z.object({
  name: z.string().min(1, 'Product name is required'),
  type: z.enum(['professional', 'retail']),
  category: z.string().min(1, 'Category is required'),
  description: z.string().optional(),
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
  wholesalePrice: z.coerce.number().optional(),
  packagingCost: z.coerce.number().optional(),
  shippingCostToCustomer: z.coerce.number().optional(),

  supplier: z.string().optional(),
  sku: z.string().optional(),
  purchaseLink: z.string().optional(),
  reorderPoint: z.coerce.number().optional(),
  initialStock: z.coerce.number().min(1, 'Initial stock is required'),
  expirationDate: z.date().optional(),
  primaryLocationId: z.string().optional(),

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

type ProductFormData = z.infer<typeof productSchema>;

const SectionHeader = ({ icon: Icon, title, step }: { icon: any, title: string, step: number }) => (
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
    const { register, control, setValue, watch, formState: { errors } } = useFormContext<ProductFormData>();
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
            <SectionHeader icon={Package} title="Identity & Type" step={1} />
            <div className="space-y-6">
                <div className="space-y-2 text-left">
                    <Label htmlFor="product-name" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Asset Name</Label>
                    <Input id="product-name" placeholder="e.g., Hydrating Shampoo" {...register('name')} className="h-14 rounded-2xl border-2 font-black uppercase text-lg tracking-tight" />
                    {errors.name && <p className="text-xs font-bold text-destructive uppercase ml-1">{errors.name.message}</p>}
                </div>

                <Controller
                    name="type"
                    control={control}
                    render={({ field }) => (
                        <div className="space-y-2 text-left">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Asset Classification</Label>
                            <RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 gap-3">
                                <label htmlFor="professional" className="cursor-pointer">
                                    <div className={cn(
                                        "flex flex-col items-center justify-center p-6 rounded-[2rem] border-2 transition-all",
                                        field.value === 'professional' ? "border-primary bg-primary/5 shadow-lg" : "border-border bg-white hover:border-primary/20"
                                    )}>
                                        <Package className={cn("mb-2 h-8 w-8", field.value === 'professional' ? "text-primary" : "text-muted-foreground opacity-40")} />
                                        <span className="text-xs font-black uppercase tracking-widest">Professional</span>
                                        <RadioGroupItem value="professional" id="professional" className="sr-only" />
                                    </div>
                                </label>
                                <label htmlFor="retail" className="cursor-pointer">
                                    <div className={cn(
                                        "flex flex-col items-center justify-center p-6 rounded-[2rem] border-2 transition-all",
                                        field.value === 'retail' ? "border-primary bg-primary/5 shadow-lg" : "border-border bg-white hover:border-primary/20"
                                    )}>
                                        <ShoppingCart className={cn("mb-2 h-8 w-8", field.value === 'retail' ? "text-primary" : "text-muted-foreground opacity-40")} />
                                        <span className="text-xs font-black uppercase tracking-widest">Retail</span>
                                        <RadioGroupItem value="retail" id="retail" className="sr-only" />
                                    </div>
                                </label>
                            </RadioGroup>
                        </div>
                    )}
                />

                <div className="space-y-2 text-left">
                    <Label htmlFor="category" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Department</Label>
                    {isAddingCategory ? (
                        <div className="flex gap-2 text-left">
                            <Input
                                placeholder="New category name..."
                                value={newCategoryName}
                                onChange={(e) => setNewCategoryName(e.target.value)}
                                className="h-12 rounded-xl border-2 font-bold uppercase text-xs"
                            />
                            <Button onClick={handleAddNewCategory} type="button" className="h-12 w-12 rounded-xl"><Check className="h-5 w-5" /></Button>
                        </div>
                    ) : (
                        <div className="flex gap-3">
                            <Controller name="category" control={control} render={({ field }) => (
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <SelectTrigger className="h-12 rounded-xl border-2 font-bold uppercase text-xs shadow-inner bg-muted/5">
                                        <SelectValue placeholder="Select a category" />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-xl border-2 shadow-2xl">
                                        {categories.map(cat => ( <SelectItem key={cat} value={cat} className="font-bold uppercase text-[10px] tracking-widest">{cat}</SelectItem> ))}
                                    </SelectContent>
                                </Select>
                            )}/>
                            <Button variant="outline" size="icon" onClick={() => setIsAddingCategory(true)} type="button" className="h-12 w-12 rounded-xl border-2"> <PlusCircle className="h-5 w-5" /> </Button>
                        </div>
                    )}
                    {errors.category && <p className="text-xs font-bold text-destructive uppercase ml-1">{errors.category.message}</p>}
                </div>

                <div className="space-y-2 text-left">
                    <Label htmlFor="product-description" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Public Description</Label>
                    <Textarea id="product-description" placeholder="Guest-facing description for retail or concierge..." {...register('description')} className="rounded-2xl border-2 bg-muted/5 min-h-[100px] focus-visible:ring-primary/20 p-4 font-medium" />
                </div>

                <div className="space-y-2 text-left">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Dossier Visual</Label>
                    <Controller name="imageUrl" control={control} render={({ field }) => ( <ImageUpload onImageUploaded={field.onChange} /> )}/>
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
        'totalPurchaseCost',
        'numUnits',
        'shippingCost',
        'taxCost',
        'discounts',
        'msrp',
        'wholesalePrice',
        'packagingCost',
        'shippingCostToCustomer'
    ]);

    const landedCostPerItem = useMemo(() => {
        const safeParse = (val: any) => parseFloat(val) || 0;
        const total = safeParse(totalPurchaseCost) + safeParse(shippingCost) + safeParse(taxCost) - safeParse(discounts);
        const units = safeParse(numUnits);
        if (units === 0) return 0;
        return total / units;
    }, [totalPurchaseCost, numUnits, shippingCost, taxCost, discounts]);

    const wholesaleProfit = useMemo(() => {
        const price = wholesalePrice || 0;
        if (price === 0 || landedCostPerItem === 0) return { profit: 0, margin: 0 };
        const profit = price - landedCostPerItem;
        const margin = (profit / price) * 100;
        return { profit, margin };
    }, [wholesalePrice, landedCostPerItem]);

    const dtcProfit = useMemo(() => {
        const price = msrp || 0;
        const totalDtcCost = landedCostPerItem + (packagingCost || 0) + (shippingCostToCustomer || 0);
        if (price === 0) return { profit: 0, margin: 0 };
        const profit = price - totalDtcCost;
        const margin = (profit / price) * 100;
        return { profit, margin };
    }, [msrp, landedCostPerItem, packagingCost, shippingCostToCustomer]);

    return (
        <div className="space-y-10">
            <SectionHeader icon={Calculator} title="Yield & Costing" step={2} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start text-left">
                <Card className="border-2 rounded-[2rem] overflow-hidden shadow-sm">
                    <CardHeader className="bg-muted/5 border-b p-6"><CardTitle className="text-sm font-black uppercase tracking-widest text-left">Landed Cost Engine</CardTitle></CardHeader>
                    <CardContent className="p-6 space-y-6">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5 text-left"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Invoice Total</Label><Input type="number" placeholder="0.00" {...register('totalPurchaseCost')} className="h-11 rounded-xl border-2 font-bold" /></div>
                            <div className="space-y-1.5 text-left"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Unit Count</Label><Input type="number" placeholder="Qty" {...register('numUnits')} className="h-11 rounded-xl border-2 font-bold" /></div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5 text-left"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Shipping</Label><Input type="number" placeholder="0.00" {...register('shippingCost')} className="h-11 rounded-xl border-2 font-bold" /></div>
                            <div className="space-y-1.5 text-left"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Taxes</Label><Input type="number" placeholder="0.00" {...register('taxCost')} className="h-11 rounded-xl border-2 font-bold" /></div>
                        </div>
                        <div className="p-5 rounded-2xl bg-primary/5 border-2 border-primary/10 flex justify-between items-center shadow-inner text-left">
                            <span className="text-[10px] font-black uppercase text-primary tracking-widest">Landed / Unit</span>
                            <span className="text-2xl font-black text-primary tracking-tighter font-mono">${landedCostPerItem.toFixed(2)}</span>
                        </div>
                    </CardContent>
                </Card>

                {productType === 'professional' ? (
                    <Card className="border-2 rounded-[2rem] overflow-hidden shadow-sm">
                        <CardHeader className="bg-muted/5 border-b p-6"><CardTitle className="text-sm font-black uppercase tracking-widest text-left">Professional Model</CardTitle></CardHeader>
                        <CardContent className="p-6 space-y-6">
                            <Controller
                                name="costingMethod"
                                control={control}
                                render={({ field }) => (
                                    <RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 gap-2">
                                        <label htmlFor="size-wizard" className="cursor-pointer">
                                            <div className={cn(
                                                "flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all",
                                                field.value === 'size' ? "border-primary bg-primary/5 shadow-md" : "border-border bg-background"
                                            )}>
                                                <Pipette className={cn("w-4 h-4 mx-auto mb-1.5", field.value === 'size' ? "text-primary" : "text-muted-foreground opacity-40")} />
                                                <span className="text-[10px] font-black uppercase tracking-widest">By Volume</span>
                                                <RadioGroupItem value="size" id="size-wizard" className="sr-only" />
                                            </div>
                                        </label>
                                        <label htmlFor="uses-wizard" className="cursor-pointer">
                                            <div className={cn(
                                                "flex flex-col items-center justify-center p-3 rounded-xl border-2 text-center transition-all",
                                                field.value === 'uses' ? "border-primary bg-primary/5 shadow-md" : "border-border bg-background"
                                            )}>
                                                <CheckCircle className={cn("w-4 h-4 mx-auto mb-1.5", field.value === 'uses' ? "text-primary" : "text-muted-foreground opacity-40")} />
                                                <span className="text-[10px] font-black uppercase tracking-widest">By Uses</span>
                                                <RadioGroupItem value="uses" id="uses-wizard" className="sr-only" />
                                            </div>
                                        </label>
                                    </RadioGroup>
                                )}
                            />
                            {costingMethod === 'size' && (
                                <div className="grid grid-cols-2 gap-4 animate-in slide-in-from-top-2 text-left">
                                    <div className="space-y-1.5 text-left"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Size</Label><Input type="number" placeholder="1000" {...register('containerSize')} className="h-11 rounded-xl border-2 font-bold" /></div>
                                    <div className="space-y-1.5 text-left"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Unit</Label>
                                        <Controller name="containerUnit" control={control} render={({ field }) => (
                                            <Select onValueChange={field.onChange} value={field.value}><SelectTrigger className="h-11 rounded-xl border-2 font-bold"><SelectValue /></SelectTrigger><SelectContent className="rounded-xl shadow-xl border-2"><SelectItem value="ml" className="font-bold">ML</SelectItem><SelectItem value="oz" className="font-bold">OZ</SelectItem><SelectItem value="g" className="font-bold">G</SelectItem></SelectContent></Select>
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
                            <div className="space-y-1.5 pt-2 border-t border-dashed border-border/50 text-left">
                                <Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Restocking Markup (%)</Label>
                                <Input type="number" placeholder="e.g., 5" {...register('restockingMarkup')} className="h-11 rounded-xl border-2 font-bold" />
                            </div>
                        </CardContent>
                    </Card>
                ) : (
                    <Card className="border-2 rounded-[2rem] overflow-hidden shadow-sm">
                        <CardHeader className="bg-muted/5 border-b p-6"><CardTitle className="text-sm font-black uppercase tracking-widest text-left">Retail Pricing Matrix</CardTitle></CardHeader>
                        <CardContent className="p-6 space-y-8">
                            <div className="p-5 rounded-2xl bg-muted/10 border-2 space-y-4">
                                <div className="flex justify-between items-center text-left"><span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Direct (MSRP)</span> <div className="relative w-32"><DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-primary"/><Input type="number" placeholder="0.00" {...register('msrp')} className="h-10 pl-7 rounded-xl border-2 font-black text-primary font-mono text-left"/></div></div>
                                <div className="flex justify-between items-center text-[10px] font-bold uppercase pt-2 border-t border-dashed border-border/50 text-left">
                                    <span className="opacity-60">Est. Profit / Margin</span>
                                    <span className={cn("font-black font-mono text-sm", dtcProfit.profit >= 0 ? "text-primary" : "text-destructive")}>${dtcProfit.profit.toFixed(2)} ({dtcProfit.margin.toFixed(0)}%)</span>
                                </div>
                            </div>
                            <div className="p-5 rounded-2xl bg-muted/10 border-2 space-y-4">
                                <div className="flex justify-between items-center text-left"><span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Wholesale</span> <div className="relative w-32"><DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-primary"/><Input type="number" placeholder="0.00" {...register('wholesalePrice')} className="h-10 pl-7 rounded-xl border-2 font-black text-primary font-mono text-left"/></div></div>
                                <div className="flex justify-between items-center text-[10px] font-bold uppercase pt-2 border-t border-dashed border-border/50 text-left">
                                    <span className="opacity-60">Est. Profit / Margin</span>
                                    <span className={cn("font-black font-mono text-sm", wholesaleProfit.profit >= 0 ? "text-primary" : "text-destructive")}>${wholesaleProfit.profit.toFixed(2)} ({wholesaleProfit.margin.toFixed(0)}%)</span>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                )}
            </div>
        </div>
    );
};

const Step3 = ({ onAddLocationClick, locations }: { onAddLocationClick: () => void, locations: Location[] }) => {
    const { register, control, formState: { errors } } = useFormContext<ProductFormData>();
    return (
        <div className="space-y-10">
            <SectionHeader icon={Truck} title="Logistics & Continuity" step={3} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start text-left">
                <div className="space-y-8">
                    <Card className="border-2 rounded-[2rem] overflow-hidden shadow-sm">
                        <CardHeader className="bg-muted/5 border-b p-6 md:p-8"><CardTitle className="text-sm font-black uppercase tracking-widest text-left flex items-center gap-3"><Building className="w-4 h-4 text-primary" /> Manufacturing Vault</CardTitle></CardHeader>
                        <CardContent className="p-6 md:p-8 space-y-6 text-left">
                            <div className="space-y-1.5 text-left"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Manufacturer Name</Label><Input placeholder="e.g., Global Formula Labs" {...register('manufacturerName')} className="h-11 rounded-xl border-2 font-bold" /></div>
                            <div className="space-y-1.5 text-left"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Manufacturer Contact</Label><Input placeholder="Primary Account Manager" {...register('manufacturerContactName')} className="h-11 rounded-xl border-2 font-bold" /></div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1.5 text-left"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Direct Email</Label><Input type="email" placeholder="rep@mfg.com" {...register('manufacturerEmail')} className="h-11 rounded-xl border-2 font-bold text-xs" /></div>
                                <div className="space-y-1.5 text-left"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Direct Phone</Label><Input placeholder="555-000-0000" {...register('manufacturerPhone')} className="h-11 rounded-xl border-2 font-bold text-xs" /></div>
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
                            <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Shop / Reorder URL</Label><Input placeholder="https://supplier.com/order/..." {...register('purchaseLink')} className="h-11 rounded-xl border-2 font-bold text-xs" /></div>
                            <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Label Design Source (URL)</Label><Input placeholder="Cloud link to design files..." {...register('labelTemplateUrl')} className="h-11 rounded-xl border-2 font-bold text-xs" /></div>
                        </CardContent>
                    </Card>
                </div>

                <div className="space-y-8">
                    <Card className="border-2 rounded-[2rem] overflow-hidden shadow-sm">
                        <CardHeader className="bg-muted/5 border-b p-6 md:p-8"><CardTitle className="text-sm font-black uppercase tracking-widest text-left flex items-center gap-3"><FileText className="w-4 h-4 text-primary opacity-40" /> Standard Operating Procedure (SOP)</CardTitle></CardHeader>
                        <CardContent className="p-6 md:p-8">
                            <Textarea placeholder="Detail the exact technical protocol for this asset..." {...register('manufacturingSop')} className="rounded-xl border-2 bg-muted/5 min-h-[200px] focus-visible:ring-primary/20 font-medium" />
                        </CardContent>
                    </Card>

                    <Card className="border-2 rounded-[2rem] overflow-hidden shadow-sm">
                        <CardHeader className="bg-muted/5 border-b p-6"><CardTitle className="text-sm font-black uppercase tracking-widest text-left">Registry & Stock</CardTitle></CardHeader>
                        <CardContent className="p-6 space-y-5 text-left">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1.5 text-left"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Starting Stock</Label><Input type="number" placeholder="Qty" {...register('initialStock')} className="h-11 rounded-xl border-2 font-black text-lg" />{errors.initialStock && <p className="text-[8px] font-black text-destructive uppercase">{errors.initialStock.message}</p>}</div>
                                <div className="space-y-1.5 text-left"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">SKU identifier</Label><Input placeholder="Registry ID" {...register('sku')} className="h-11 rounded-xl border-2 font-mono font-black" /></div>
                            </div>
                            <div className="space-y-1.5 text-left">
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
                                    <Button variant="outline" size="icon" onClick={onAddLocationClick} type="button" className="h-11 w-11 rounded-xl border-2 shrink-0"><PlusCircle className="h-5 w-5" /></Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
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
    defaultValues: { type: initialType, costingMethod: 'size', initialStock: 1 }
  });

  useEffect(() => {
    if (open) {
      methods.reset({ type: initialType, costingMethod: 'size', initialStock: 1 });
      setStep(1);
    }
  }, [open, initialType, methods]);

  const { trigger, handleSubmit } = methods;
  
  const onSubmit = (data: ProductFormData) => {
    const costPerUnit = (data.numUnits || 1) > 0 ? ((data.totalPurchaseCost || 0) + (data.shippingCost || 0) + (data.taxCost || 0) - (data.discounts || 0)) / (data.numUnits || 1) : 0;
    
    onProductAdded({
        id: `prod-${nanoid(8)}`,
        name: data.name,
        type: data.type,
        category: data.category,
        description: data.description,
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
        msrp: data.msrp,
        restockingMarkup: data.restockingMarkup,
        internalNotes: data.internalNotes,
        wholesalePrice: data.wholesalePrice,
        packagingCost: data.packagingCost,
        shippingCostToCustomer: data.shippingCostToCustomer,
        manufacturerName: data.manufacturerName,
        manufacturerContactName: data.manufacturerContactName,
        manufacturerEmail: data.manufacturerEmail,
        manufacturerPhone: data.manufacturerPhone,
        manufacturingSop: data.manufacturingSop,
        labelTemplateUrl: data.labelTemplateUrl,
        moq: data.moq,
        leadTimeDays: data.leadTimeDays,
        batches: [{ id: `batch-${nanoid(6)}`, stock: data.initialStock || 0, costPerUnit: costPerUnit, receivedDate: new Date().toISOString(), expirationDate: data.expirationDate?.toISOString() }],
    });
    onOpenChange(false);
  };
  
    const handleNext = async (e: React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
        const fieldsToValidate: (keyof ProductFormData)[] = [];
        if (step === 1) fieldsToValidate.push('name', 'category');
        if (step === 3) fieldsToValidate.push('initialStock');
        
        const isValid = fieldsToValidate.length > 0 ? await trigger(fieldsToValidate) : true;
        if (isValid && step < totalSteps) setStep(step + 1);
    };

    const handleBack = (e: React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
        if (step > 1) setStep(step - 1);
    };

  const getStepContent = () => {
      switch(step) {
          case 1: return <Step1 categories={categories} onNewCategory={onNewCategory} />;
          case 2: return <Step2 />;
          case 3: return <Step3 onAddLocationClick={onAddLocationClick} locations={locations} />;
          default: return null;
      }
  }
  
  const title = `Add New Asset`;
  const description = `Register a ${initialType} item into your studio manifest.`;

  const formBody = (
     <FormProvider {...methods}>
      <form id="add-inventory-asset-form" onSubmit={handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
        <DialogHeader className={cn("flex-shrink-0 text-left border-b bg-muted/5", isMobile ? "p-6" : "p-8 pb-6")}>
          <div className="flex items-center gap-3 mb-2">
            <PlusCircle className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Strategic Intake</span>
          </div>
          <DialogTitle className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">{title}</DialogTitle>
          <DialogDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">{description}</DialogDescription>
          <div className="pt-6"><Progress value={(step / totalSteps) * 100} className="h-1 rounded-full bg-muted" /></div>
        </DialogHeader>
        <ScrollArea className="flex-1">
            <div className={cn("pb-32", isMobile ? "p-6" : "p-8")}>
                {getStepContent()}
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
                <Button type="submit" className="flex-[1.5] h-12 md:h-16 font-black uppercase tracking-widest text-[10px] md:text-xl rounded-[2rem] shadow-2xl shadow-primary/30">Save Asset</Button>
              )}
            </div>
          </div>
        </DialogFooter>
      </form>
    </FormProvider>
  );

  const DialogContainer = isMobile ? Sheet : Dialog;
  const DialogContentContainer = isMobile ? SheetContent : DialogContent;

  return (
    <DialogContainer open={open} onOpenChange={onOpenChange}>
      <DialogContentContainer side="right" className={cn("p-0 border-none bg-background flex flex-col shadow-3xl overflow-hidden", isMobile ? "h-[92dvh] rounded-t-[2.5rem]" : "sm:max-w-4xl max-h-[90dvh]")}>
        {formBody}
      </DialogContentContainer>
    </DialogContainer>
  );
};
