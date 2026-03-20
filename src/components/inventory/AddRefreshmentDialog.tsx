
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
import { 
    PlusCircle, 
    Calendar as CalendarIcon, 
    DollarSign, 
    Coffee, 
    Sparkles, 
    ArrowRight, 
    Pipette, 
    CheckCircle, 
    Check, 
    Building, 
    Truck, 
    Tag, 
    Trash2, 
    ListChecks, 
    Activity,
    FlaskConical,
    Calculator,
    Target,
    Info,
    FileText,
    Lock
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useForm, Controller, FormProvider, useFormContext } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { type InventoryItem, type Location } from '@/lib/data';
import { Calendar } from '../ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { cn, safeNumber } from '@/lib/utils';
import { format } from 'date-fns';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { ScrollArea } from '../ui/scroll-area';
import { Progress } from '../ui/progress';
import { nanoid } from 'nanoid';
import { ImageUpload } from '../shared/ImageUpload';
import { BrowseProductsDialog } from '../services/BrowseProductsDialog';
import { useInventory } from '@/context/InventoryContext';
import { Separator } from '../ui/separator';
import { Switch } from '../ui/switch';
import { Badge } from '../ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
  CardDescription
} from '@/components/ui/card';

const refreshmentSchema = z.object({
  name: z.string().min(1, 'Amenity name is required.'),
  description: z.string().optional(),
  category: z.string().default('Refreshment'),
  price: z.coerce.number().min(0).default(0),
  showInConcierge: z.boolean().default(true),
  isMembersOnly: z.boolean().default(false),
  purchaseCost: z.coerce.number().min(0, 'Purchase cost must be a positive number.'),
  purchaseDate: z.date({ required_error: 'A purchase date is required.' }),
  costingMethod: z.enum(['size', 'uses']),
  containerSize: z.coerce.number().optional(),
  containerUnit: z.string().optional(),
  usesPerContainer: z.coerce.number().optional(),
  initialStock: z.coerce.number().min(1, 'Initial stock must be at least 1.'),
  supplier: z.string().optional(),
  primaryLocationId: z.string().optional(),
  imageUrl: z.string().optional(),
  formula: z.array(z.object({
      id: z.string(),
      name: z.string(),
      quantityUsed: z.coerce.number(),
      unit: z.string(),
      costPerUnit: z.coerce.number().optional()
  })).optional(),
});

type RefreshmentFormData = z.infer<typeof refreshmentSchema>;

const SectionHeader = ({ icon: Icon, title, step }: { icon: any, title: string, step: number | string }) => (
    <div className="flex items-center gap-4 mb-6 text-left">
        <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shadow-inner border border-primary/20 shrink-0">
            <Icon className="w-5 h-5" />
        </div>
        <div className="space-y-0.5 text-left">
            <p className="text-[8px] font-black uppercase tracking-widest text-primary/60">Module {step}</p>
            <h3 className="text-xl font-black uppercase tracking-tighter text-slate-900">{title}</h3>
        </div>
    </div>
);

const Step1 = () => {
    const { register, control, formState: { errors } } = useFormContext<RefreshmentFormData>();
    return (
        <div className="space-y-10">
            <SectionHeader icon={Coffee} title="Identity & Menu Label" step={1} />
            <div className="space-y-6">
                <div className="space-y-2 text-left">
                    <Label htmlFor="item-name" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Guest-Facing Name</Label>
                    <Input id="item-name" placeholder="e.g., Oat Milk Espresso" {...register('name')} className="h-14 rounded-2xl border-2 font-black uppercase text-lg tracking-tight shadow-inner" />
                    {errors.name && <p className="text-[10px] font-black text-destructive uppercase ml-1">{errors.name.message}</p>}
                </div>

                <div className="space-y-2 text-left">
                    <Label htmlFor="item-description" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Public Description</Label>
                    <Textarea id="item-description" placeholder="Describe flavor profiles or ingredients..." {...register('description')} className="rounded-2xl border-2 bg-muted/5 min-h-[100px] focus-visible:ring-primary/20 p-4 font-medium" />
                </div>
                
                <div className="space-y-2 text-left">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Amenity visual</Label>
                    <Controller name="imageUrl" control={control} render={({ field }) => ( <ImageUpload onImageUploaded={field.onChange} initialImage={field.value} /> )}/>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="space-y-2 text-left">
                        <Label htmlFor="retail-price" className="text-[10px] font-black uppercase tracking-widest text-primary ml-1">Retail Price ($)</Label>
                        <div className="relative">
                            <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary opacity-40" />
                            <Input id="retail-price" type="number" step="0.01" {...register('price')} className="h-14 pl-12 rounded-2xl border-2 font-black text-xl font-mono text-primary shadow-inner bg-primary/5" />
                        </div>
                        <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-60 ml-1 text-left">Leave at 0.00 for complimentary amenity</p>
                    </div>
                    <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between p-4 rounded-2xl border-2 bg-muted/5 shadow-inner">
                            <div className="space-y-1 text-left">
                                <Label htmlFor="show-concierge" className="text-sm font-black uppercase tracking-tight">Public Menu</Label>
                                <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-60 text-left">Visible in Portal</p>
                            </div>
                            <Controller name="showInConcierge" control={control} render={({ field }) => (
                                <Switch id="show-concierge" checked={field.value} onCheckedChange={field.onChange} className="scale-110 data-[state=checked]:bg-primary" />
                            )}/>
                        </div>
                        <div className="flex items-center justify-between p-4 rounded-2xl border-2 border-indigo-500/20 bg-indigo-500/5 shadow-inner">
                            <div className="space-y-1 text-left">
                                <Label htmlFor="members-only" className="text-sm font-black uppercase tracking-tight text-indigo-700 flex items-center gap-2">
                                    <Lock className="w-3 h-3" /> Members Only
                                </Label>
                                <p className="text-[9px] font-bold text-indigo-600/60 uppercase tracking-widest opacity-60 text-left">Restricted access item</p>
                            </div>
                            <Controller name="isMembersOnly" control={control} render={({ field }) => (
                                <Switch id="members-only" checked={field.value} onCheckedChange={field.onChange} className="scale-110 data-[state=checked]:bg-indigo-600" />
                            )}/>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const Step2 = ({ locations }: { locations: Location[] }) => {
    const { inventory } = useInventory();
    const { control, register, watch, setValue, formState: { errors } } = useFormContext<RefreshmentFormData>();
    const [isProductBrowserOpen, setIsProductBrowserOpen] = useState(false);
    
    const costingMethod = watch('costingMethod');
    const formula = watch('formula') || [];
    const retailPrice = watch('price') || 0;

    const calculatedFormulaCost = useMemo(() => {
        return formula.reduce((sum, item) => sum + (safeNumber(item.quantityUsed) * safeNumber(item.costPerUnit)), 0);
    }, [formula]);

    useEffect(() => {
        if (formula.length > 0) {
            setValue('purchaseCost', Number(calculatedFormulaCost.toFixed(2)), { shouldDirty: true });
        }
    }, [calculatedFormulaCost, formula.length, setValue]);

    const handleAddIngredients = (products: InventoryItem[]) => {
        const newIngredients = products.map(p => {
            let unit = p.costingMethod === 'size' ? (p.unit || 'ml') : (p.useUnit || 'uses');
            let cpu = p.costPerUnit || 0;
            if (p.costingMethod === 'size' && p.size) cpu = (p.costPerUnit || 0) / p.size;
            else if (p.costingMethod === 'uses' && p.estimatedUses) cpu = (p.costPerUnit || 0) / p.estimatedUses;

            return {
                id: p.id,
                name: p.name,
                quantityUsed: 1,
                unit,
                costPerUnit: cpu
            };
        });
        setValue('formula', [...formula, ...newIngredients.filter(ni => !formula.find(f => f.id === ni.id))], { shouldDirty: true });
        setIsProductBrowserOpen(false);
    };

    const profitMargin = retailPrice > 0 ? ((retailPrice - calculatedFormulaCost) / retailPrice) * 100 : 0;

    return (
        <div className="space-y-10">
            <SectionHeader icon={FlaskConical} title="Yield & Technical Recipe" step={2} />
            <div className="space-y-8">
                <div className="space-y-4">
                    <div className="flex items-center justify-between px-1 text-left">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Technical Recipe (Ingredients)</Label>
                        <Button variant="ghost" size="sm" type="button" onClick={() => setIsProductBrowserOpen(true)} className="h-7 px-3 text-[9px] font-black uppercase tracking-widest text-primary border border-primary/20 rounded-lg hover:bg-primary/5 shadow-sm">
                            <PlusCircle className="w-3 h-3 mr-1.5" /> Append Inventory
                        </Button>
                    </div>
                    {formula.length > 0 ? (
                        <div className="grid gap-2">
                            {formula.map((item, index) => (
                                <div key={item.id} className="flex items-center justify-between p-4 rounded-2xl border-2 bg-white shadow-sm gap-4 group">
                                    <div className="min-w-0 flex-1 text-left">
                                        <p className="text-[11px] font-black uppercase tracking-tight text-slate-900 truncate text-left">{item.name}</p>
                                        <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-60 text-left">Basis: ${(item.costPerUnit || 0).toFixed(4)} / {item.unit}</p>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <div className="flex items-center gap-2">
                                            <Label className="text-[8px] font-black uppercase text-muted-foreground opacity-40">Load</Label>
                                            <Input 
                                                type="number" 
                                                value={item.quantityUsed} 
                                                onChange={e => {
                                                    const next = [...formula];
                                                    next[index].quantityUsed = parseFloat(e.target.value) || 0;
                                                    setValue('formula', next, { shouldDirty: true });
                                                }}
                                                className="w-16 h-9 rounded-lg border-2 text-center font-black font-mono text-xs" 
                                                step="0.1" 
                                            />
                                            <span className="text-[9px] font-black uppercase text-muted-foreground w-8 opacity-60 text-left truncate">{item.unit}</span>
                                        </div>
                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => setValue('formula', formula.filter(f => f.id !== item.id))}><Trash2 className="w-4 h-4" /></Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="p-12 text-center border-4 border-dashed rounded-[2.5rem] opacity-30 flex flex-col items-center gap-3">
                            <Activity className="w-10 h-10" />
                            <p className="text-[10px] font-black uppercase tracking-widest">Pure Stock (No Recipe)</p>
                        </div>
                    )}
                </div>

                {formula.length > 0 && (
                    <Card className="border-4 border-primary/20 bg-primary/5 rounded-[2.5rem] shadow-xl shadow-primary/5 overflow-hidden">
                        <CardHeader className="p-6 pb-2 border-b bg-white/50 backdrop-blur-sm text-left">
                            <CardTitle className="text-[10px] font-black uppercase tracking-widest text-primary flex items-center gap-2">
                                <Calculator className="w-3.5 h-3.5" /> Recipe Yield Analysis
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-6 grid grid-cols-2 gap-6">
                            <div className="space-y-1 text-left">
                                <p className="text-[9px] font-black uppercase text-muted-foreground opacity-60">Calculated Cost</p>
                                <p className="text-3xl font-black font-mono tracking-tighter text-slate-900">${calculatedFormulaCost.toFixed(2)}</p>
                            </div>
                            <div className="space-y-1 text-right">
                                <p className="text-[9px] font-black uppercase text-primary tracking-widest">Net Margin</p>
                                <p className={cn("text-3xl font-black font-mono tracking-tighter", profitMargin >= 0 ? "text-primary" : "text-destructive")}>
                                    {profitMargin.toFixed(0)}%
                                </p>
                            </div>
                        </CardContent>
                    </Card>
                )}

                <Separator className="border-dashed" />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start text-left">
                    <div className="space-y-6">
                        <div className="space-y-2 text-left">
                            <Label htmlFor="purchase-cost" className="text-[10px] font-black uppercase text-muted-foreground ml-1">Landed Cost (Unit Basis)</Label>
                            <div className="relative">
                                <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary opacity-40" />
                                <Input 
                                    id="purchase-cost" 
                                    type="number" 
                                    step="0.01" 
                                    placeholder="0.00" 
                                    {...register('purchaseCost')} 
                                    className={cn("h-14 pl-10 rounded-2xl border-2 font-black text-xl font-mono text-primary shadow-inner", formula.length > 0 ? "bg-muted/20" : "bg-white")} 
                                    readOnly={formula.length > 0}
                                />
                            </div>
                            {formula.length > 0 && <p className="text-[8px] font-bold text-primary uppercase ml-1">Locked: Value derived from formula</p>}
                        </div>
                        <div className="space-y-2 text-left">
                            <Label htmlFor="initial-stock" className="text-[10px] font-black uppercase text-muted-foreground ml-1">Initial Stock (Units)</Label>
                            <Input id="initial-stock" type="number" placeholder="e.g., 12" {...register('initialStock')} className="h-14 rounded-2xl border-2 font-black text-xl shadow-inner bg-muted/5" />
                        </div>
                    </div>
                    <div className="space-y-6">
                        <div className="space-y-2 text-left">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Deduction Protocol</Label>
                            <Controller name="costingMethod" control={control} render={({ field }) => (
                                <RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 gap-2">
                                    <label htmlFor="size-rf" className="cursor-pointer">
                                        <div className={cn("flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all", field.value === 'size' ? "border-primary bg-primary/5 shadow-md" : "border-border bg-background")}>
                                            <Pipette className={cn("w-4 h-4 mx-auto mb-1.5", field.value === 'size' ? "text-primary" : "text-muted-foreground opacity-40")} />
                                            <span className="text-[10px] font-black uppercase tracking-widest">By Volume</span>
                                            <RadioGroupItem value="size" id="size-rf" className="sr-only" />
                                        </div>
                                    </label>
                                    <label htmlFor="uses-rf" className="cursor-pointer">
                                        <div className={cn("p-3 rounded-xl border-2 text-center transition-all", field.value === 'uses' ? "border-primary bg-primary/5 shadow-md" : "border-border bg-background")}>
                                            <CheckCircle className={cn("w-4 h-4 mx-auto mb-1.5", field.value === 'uses' ? "text-primary" : "text-muted-foreground opacity-40")} />
                                            <span className="text-[10px] font-black uppercase tracking-widest">By Portions</span>
                                            <RadioGroupItem value="uses" id="uses-rf" className="sr-only" />
                                        </div>
                                    </label>
                                </RadioGroup>
                            )}/>
                        </div>
                        {costingMethod === 'size' ? (
                            <div className="grid grid-cols-2 gap-4 animate-in slide-in-from-top-2 text-left">
                                <div className="space-y-1.5 text-left"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Capacity</Label><Input type="number" {...register('containerSize')} className="h-11 rounded-xl border-2 font-bold" /></div>
                                <div className="space-y-1.5 text-left"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Unit</Label>
                                    <Controller name="containerUnit" control={control} render={({ field }) => (
                                        <Select onValueChange={field.onChange} value={field.value}><SelectTrigger className="h-11 rounded-xl border-2 font-bold"><SelectValue /></SelectTrigger><SelectContent className="rounded-xl shadow-xl border-2"><SelectItem value="ml" className="font-bold">ML</SelectItem><SelectItem value="oz" className="font-bold">OZ</SelectItem><SelectItem value="g" className="font-bold">G</SelectItem></SelectContent></Select>
                                    )}/>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-1.5 animate-in slide-in-from-top-2 text-left">
                                <Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Est. Servings / Unit</Label>
                                <Input type="number" placeholder="e.g., 25 servings" {...register('usesPerContainer')} className="h-14 rounded-2xl border-2 font-black text-xl shadow-inner bg-muted/5 text-center" />
                            </div>
                        )}
                    </div>
                </div>
            </div>
            <BrowseProductsDialog open={isProductBrowserOpen} onOpenChange={setIsProductBrowserOpen} onSelect={handleAddIngredients} allProducts={inventory.filter(p => p.type === 'professional' || p.type === 'overhead')} initialSelected={[]} />
        </div>
    )
};

const Step3 = ({ locations }: { locations: Location[] }) => {
    const { register, control } = useFormContext<RefreshmentFormData>();
    return (
        <div className="space-y-10">
            <SectionHeader icon={Building} title="Logistics & Zone" step={3} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start text-left">
                <div className="space-y-6">
                    <div className="space-y-1.5">
                        <Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Primary Zone</Label>
                        <Controller name="primaryLocationId" control={control} render={({ field }) => (
                            <Select onValueChange={field.onChange} value={field.value}>
                                <SelectTrigger className="h-14 rounded-2xl border-2 font-bold uppercase text-[10px] tracking-widest bg-muted/5 shadow-inner">
                                    <SelectValue placeholder="Select Zone" />
                                </SelectTrigger>
                                <SelectContent className="rounded-xl border-2 shadow-2xl">
                                    {locations.map(loc => (<SelectItem key={loc.id} value={loc.id} className="font-bold uppercase text-[9px] tracking-widest">{loc.name}</SelectItem>))}
                                </SelectContent>
                            </Select>
                        )}/>
                    </div>
                    <div className="space-y-1.5 text-left"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Source / Supplier</Label><Input placeholder="e.g., Whole Foods" {...register('supplier')} className="h-12 rounded-xl border-2 font-bold" /></div>
                </div>
                <div className="space-y-6">
                    <div className="space-y-1.5 text-left">
                        <Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Intake Date</Label>
                        <Controller name="purchaseDate" control={control} render={({ field }) => (
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button variant="outline" className="w-full h-12 rounded-xl border-2 font-bold justify-start px-4 text-xs bg-muted/5 shadow-inner">
                                        <CalendarIcon className="mr-2 h-4 w-4 opacity-40" />
                                        {field.value ? format(field.value, 'MMM d, yyyy') : 'Pick a date'}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0 rounded-3xl overflow-hidden shadow-3xl border-4"><Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus /></PopoverContent>
                            </Popover>
                        )}/>
                    </div>
                </div>
            </div>
        </div>
    )
}

export const AddRefreshmentDialog = ({
  open, onOpenChange, onRefreshmentAdded, locations,
}: {
  open: boolean; onOpenChange: (open: boolean) => void; onRefreshmentAdded: (item: InventoryItem) => void; locations: Location[];
}) => {
  const [step, setStep] = useState(1);
  const totalSteps = 3;
  const isMobile = useIsMobile();
  const methods = useForm<RefreshmentFormData>({ 
    resolver: zodResolver(refreshmentSchema), 
    defaultValues: { costingMethod: 'uses', initialStock: 1, category: 'Refreshment', purchaseDate: new Date(), showInConcierge: true, isMembersOnly: false, price: 0, formula: [] } 
  });

  useEffect(() => { if (open) { methods.reset({ costingMethod: 'uses', initialStock: 1, category: 'Refreshment', purchaseDate: new Date(), showInConcierge: true, isMembersOnly: false, price: 0, formula: [] }); setStep(1); } }, [open, methods]);

  const { handleSubmit, trigger } = methods;
  const onSubmit = (data: RefreshmentFormData) => {
    const unitPrice = data.purchaseCost; 
    onRefreshmentAdded({
      id: `refr-${nanoid(8)}`, name: data.name, description: data.description, type: 'refreshment', category: 'Refreshment', totalStock: data.initialStock, costPerUnit: unitPrice, supplier: data.supplier || '', primaryLocationId: data.primaryLocationId, costingMethod: data.costingMethod, size: data.containerSize, unit: data.containerUnit as any, estimatedUses: data.usesPerContainer, showInConcierge: data.showInConcierge, isMembersOnly: data.isMembersOnly, price: data.price, imageUrl: data.imageUrl, formula: data.formula,
      batches: [{ id: `batch-${nanoid(6)}`, stock: data.initialStock, costPerUnit: unitPrice, receivedDate: data.purchaseDate.toISOString() }],
    });
    onOpenChange(false);
  };

  const handleNext = async (e: any) => { e.preventDefault(); if (await trigger(step === 1 ? ['name'] : [])) setStep(step + 1); };
  const handleBack = (e: any) => { e.preventDefault(); setStep(step - 1); };

  const formBody = (
    <FormProvider {...methods}>
      <form id="add-refreshment-wizard-form" onSubmit={handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
        <DialogHeader className={cn("flex-shrink-0 text-left border-b bg-muted/5", isMobile ? "p-6" : "p-8 pb-6")}>
          <div className="flex items-center gap-3 mb-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Strategic Intake</span>
          </div>
          <DialogTitle className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">Register Amenity</DialogTitle>
          <DialogDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">Configure guest-facing refreshments and recipe logic.</DialogDescription>
          <div className="pt-6"><Progress value={(step / totalSteps) * 100} className="h-1 rounded-full bg-muted" /></div>
        </DialogHeader>
        <ScrollArea className="flex-1">
            <div className={cn("pb-32", isMobile ? "p-6" : "p-8")}>
                {step === 1 && <Step1 />}
                {step === 2 && <Step2 locations={locations} />}
                {step === 3 && <Step3 locations={locations} />}
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
                <Button type="submit" form="add-refreshment-wizard-form" className="flex-[1.5] h-12 md:h-16 font-black uppercase tracking-widest text-[10px] md:text-xl rounded-[2rem] shadow-2xl shadow-primary/30">Commit to Menu</Button>
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
