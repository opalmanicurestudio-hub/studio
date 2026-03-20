'use client';

import React, { useState, useEffect } from 'react';
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
import { PlusCircle, Calendar as CalendarIcon, DollarSign, Recycle, Sparkles, ArrowRight, Pipette, CheckCircle, Check, Building, Truck, FileText } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { ScrollArea } from '../ui/scroll-area';
import { Progress } from '../ui/progress';
import { Textarea } from '../ui/textarea';
import { nanoid } from 'nanoid';

const overheadSchema = z.object({
  name: z.string().min(1, 'Item name is required.'),
  category: z.string().min(1, 'Category is required.'),
  description: z.string().optional(),
  purchaseCost: z.coerce.number().min(0, 'Purchase cost must be a positive number.'),
  purchaseDate: z.date({ required_error: 'A purchase date is required.' }),
  costingMethod: z.enum(['size', 'uses']),
  containerSize: z.coerce.number().optional(),
  containerUnit: z.string().optional(),
  usesPerContainer: z.coerce.number().optional(),
  initialStock: z.coerce.number().min(1, 'Initial stock must be at least 1.'),
  supplier: z.string().optional(),
  primaryLocationId: z.string().optional(),
});

type OverheadFormData = z.infer<typeof overheadSchema>;

const SectionHeader = ({ icon: Icon, title, step }: { icon: any, title: string, step: number }) => (
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

const Step1 = ({ categories, onNewCategory }: { categories: string[], onNewCategory: (cat: string) => void }) => {
    const { control, register, setValue, formState: { errors } } = useFormContext<OverheadFormData>();
    const [isAddingCategory, setIsAddingCategory] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState('');

    const handleAddNewCategory = () => {
        if (newCategoryName.trim()) {
            onNewCategory(newCategoryName.trim());
            setValue('category', newCategoryName.trim());
            setIsAddingCategory(false);
            setNewCategoryName('');
        }
    };

    return (
        <div className="space-y-10">
            <SectionHeader icon={Recycle} title="Identity & Consumable" step={1} />
            <div className="space-y-6 text-left">
                <div className="space-y-2">
                    <Label htmlFor="item-name-ov" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Asset Label</Label>
                    <Input id="item-name-ov" placeholder="e.g., Disinfectant Wipes" {...register('name')} className="h-14 rounded-2xl border-2 font-black uppercase text-lg tracking-tight" />
                    {errors.name && <p className="text-xs font-bold text-destructive uppercase ml-1">{errors.name.message}</p>}
                </div>
                <div className="space-y-2">
                    <Label htmlFor="category-ov" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Department</Label>
                    {isAddingCategory ? (
                        <div className="flex gap-2 text-left">
                            <Input placeholder="New category..." value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} className="h-12 rounded-xl border-2 font-bold uppercase text-xs" />
                            <Button onClick={handleAddNewCategory} type="button" className="h-12 w-12 rounded-xl"><Check className="h-5 w-5" /></Button>
                        </div>
                    ) : (
                        <div className="flex gap-2">
                            <Controller name="category" control={control} render={({ field }) => (
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <SelectTrigger className="h-12 rounded-xl border-2 font-bold uppercase text-xs shadow-inner bg-muted/5"><SelectValue placeholder="Select category" /></SelectTrigger>
                                    <SelectContent className="rounded-xl border-2 shadow-2xl">
                                        {categories.map(cat => (<SelectItem key={cat} value={cat} className="font-bold uppercase text-[10px] tracking-widest">{cat}</SelectItem>))}
                                    </SelectContent>
                                </Select>
                            )}/>
                            <Button variant="outline" size="icon" onClick={() => setIsAddingCategory(true)} type="button" className="h-12 w-12 rounded-xl border-2"><PlusCircle className="h-5 w-5" /></Button>
                        </div>
                    )}
                </div>
                <div className="space-y-2 text-left">
                    <Label htmlFor="item-description-ov" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Asset Description</Label>
                    <Textarea id="item-description-ov" placeholder="Internal details regarding this overhead supply..." {...register('description')} className="rounded-2xl border-2 bg-muted/5 min-h-[100px] focus-visible:ring-primary/20 p-4 font-medium" />
                </div>
            </div>
        </div>
    );
};

const Step2 = () => {
    const { control, register, watch, formState: { errors } } = useFormContext<OverheadFormData>();
    const costingMethod = watch('costingMethod');
    return (
        <div className="space-y-10">
            <SectionHeader icon={DollarSign} title="Yield & Costing" step={2} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start text-left">
                <div className="space-y-6">
                    <div className="space-y-2 text-left">
                        <Label htmlFor="purchase-cost-ov" className="text-[10px] font-black uppercase text-muted-foreground ml-1">Total Payout</Label>
                        <div className="relative">
                            <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary" />
                            <Input id="purchase-cost-ov" type="number" step="0.01" placeholder="0.00" {...register('purchaseCost')} className="h-14 pl-10 rounded-2xl border-2 font-black text-xl font-mono text-primary shadow-inner" />
                        </div>
                    </div>
                    <div className="space-y-2 text-left">
                        <Label htmlFor="initial-stock-ov" className="text-[10px] font-black uppercase text-muted-foreground ml-1">Unit Count (Containers)</Label>
                        <Input id="initial-stock-ov" type="number" placeholder="e.g., 12" {...register('initialStock')} className="h-14 rounded-2xl border-2 font-black text-xl shadow-inner bg-muted/5 text-center" />
                    </div>
                </div>
                <div className="space-y-6">
                    <div className="space-y-2 text-left">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Consumption Logic</Label>
                        <Controller name="costingMethod" control={control} render={({ field }) => (
                            <RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 gap-2">
                                <label htmlFor="size-ov" className="cursor-pointer">
                                    <div className={cn("p-3 rounded-xl border-2 text-center transition-all", field.value === 'size' ? "border-primary bg-primary/5 shadow-md" : "border-border bg-background")}>
                                        <Pipette className={cn("w-4 h-4 mx-auto mb-1.5", field.value === 'size' ? "text-primary" : "text-muted-foreground opacity-40")} />
                                        <span className="text-[10px] font-black uppercase tracking-widest">By Volume</span>
                                        <RadioGroupItem value="size" id="size-ov" className="sr-only" />
                                    </div>
                                </label>
                                <label htmlFor="uses-ov" className="cursor-pointer">
                                    <div className={cn("p-3 rounded-xl border-2 text-center transition-all", field.value === 'uses' ? "border-primary bg-primary/5 shadow-md" : "border-border bg-background")}>
                                        <CheckCircle className={cn("w-4 h-4 mx-auto mb-1.5", field.value === 'uses' ? "text-primary" : "text-muted-foreground opacity-40")} />
                                        <span className="text-[10px] font-black uppercase tracking-widest">By Uses</span>
                                        <RadioGroupItem value="uses" id="uses-ov" className="sr-only" />
                                    </div>
                                </label>
                            </RadioGroup>
                        )}/>
                    </div>
                    {costingMethod === 'size' ? (
                        <div className="grid grid-cols-2 gap-4 animate-in slide-in-from-top-2 text-left">
                            <div className="space-y-1.5 text-left"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Size</Label><Input type="number" {...register('containerSize')} className="h-11 rounded-xl border-2 font-bold" /></div>
                            <div className="space-y-1.5 text-left"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Unit</Label>
                                <Controller name="containerUnit" control={control} render={({ field }) => (
                                    <Select onValueChange={field.onChange} value={field.value}><SelectTrigger className="h-11 rounded-xl border-2 font-bold"><SelectValue /></SelectTrigger><SelectContent className="rounded-xl shadow-xl border-2"><SelectItem value="ml" className="font-bold">ML</SelectItem><SelectItem value="oz" className="font-bold">OZ</SelectItem><SelectItem value="g" className="font-bold">G</SelectItem><SelectItem value="sheets" className="font-bold">SHEETS</SelectItem></SelectContent></Select>
                                )}/>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-1.5 animate-in slide-in-from-top-2 text-left">
                            <Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Est. Uses / Container</Label>
                            <Input type="number" placeholder="e.g., 100 wipes" {...register('usesPerContainer')} className="h-14 rounded-2xl border-2 font-black text-xl shadow-inner bg-muted/5 text-center" />
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
};

const Step3 = ({ locations, onAddLocationClick }: { locations: Location[], onAddLocationClick: () => void }) => {
    const { register, control } = useFormContext<OverheadFormData>();
    return (
        <div className="space-y-10">
            <SectionHeader icon={Building} title="Logistics & Zone" step={3} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start text-left">
                <div className="space-y-6">
                    <div className="space-y-1.5 text-left"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Primary Zone</Label>
                        <div className="flex gap-2">
                            <Controller name="primaryLocationId" control={control} render={({ field }) => (
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <SelectTrigger className="h-11 rounded-xl border-2 font-bold uppercase text-[10px] tracking-widest flex-1 bg-muted/5 shadow-inner"><SelectValue placeholder="Select Zone" /></SelectTrigger>
                                    <SelectContent className="rounded-xl border-2 shadow-2xl">{locations.map(loc => (<SelectItem key={loc.id} value={loc.id} className="font-bold uppercase text-[9px] tracking-widest">{loc.name}</SelectItem>))}</SelectContent>
                                </Select>
                            )}/>
                            <Button variant="outline" size="icon" type="button" className="h-11 w-11 rounded-xl border-2 shrink-0"><PlusCircle className="h-5 w-5" /></Button>
                        </div>
                    </div>
                    <div className="space-y-1.5 text-left"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Source / Supplier</Label><Input placeholder="e.g., Uline" {...register('supplier')} className="h-11 rounded-xl border-2 font-bold" /></div>
                </div>
                <div className="space-y-6">
                    <div className="space-y-1.5 text-left">
                        <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground ml-1">Intake Date</Label>
                        <Controller name="purchaseDate" control={control} render={({ field }) => (
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button variant="outline" className="w-full h-11 rounded-xl border-2 font-bold justify-start px-4 text-xs bg-muted/5"><CalendarIcon className="mr-2 h-4 w-4 opacity-40" /> {field.value ? format(field.value, 'MMM d, yyyy') : 'Pick a date'}</Button>
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

export const AddOverheadDialog = ({
  open, onOpenChange, categories, onNewCategory, onOverheadAdded, locations,
}: {
  open: boolean; onOpenChange: (open: boolean) => void; categories: string[]; onNewCategory: (category: string) => void; onOverheadAdded: (overhead: InventoryItem) => void; locations: Location[];
}) => {
  const [step, setStep] = useState(1);
  const totalSteps = 3;
  const isMobile = useIsMobile();
  const methods = useForm<OverheadFormData>({ resolver: zodResolver(overheadSchema), defaultValues: { costingMethod: 'uses', initialStock: 1 } });

  useEffect(() => { if (open) { methods.reset({ costingMethod: 'uses', initialStock: 1, purchaseDate: new Date() }); setStep(1); } }, [open, methods]);

  const { handleSubmit, trigger } = methods;
  const onSubmit = (data: OverheadFormData) => {
    const unitPrice = data.initialStock > 0 ? (data.purchaseCost / data.initialStock) : 0;
    onOverheadAdded({
      id: `ovhd-${nanoid(8)}`, name: data.name, description: data.description, type: 'overhead', category: data.category, totalStock: data.initialStock, costPerUnit: unitPrice, supplier: data.supplier || '', primaryLocationId: data.primaryLocationId, costingMethod: data.costingMethod, size: data.containerSize, unit: data.containerUnit as any, estimatedUses: data.usesPerContainer,
      batches: [{ id: `batch-${nanoid(6)}`, stock: data.initialStock, costPerUnit: unitPrice, receivedDate: data.purchaseDate.toISOString() }],
    });
    onOpenChange(false);
  };

  const handleNext = async (e: any) => { e.preventDefault(); if (await trigger(step === 1 ? ['name', 'category'] : [])) setStep(step + 1); };
  const handleBack = (e: any) => { e.preventDefault(); setStep(step - 1); };

  const formBody = (
    <FormProvider {...methods}>
      <form id="add-overhead-wizard-form" onSubmit={handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
        <DialogHeader className={cn("flex-shrink-0 text-left border-b bg-muted/5", isMobile ? "p-6" : "p-8 pb-6")}>
          <div className="flex items-center gap-3 mb-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Strategic Intake</span>
          </div>
          <DialogTitle className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">Register Overhead Supply</DialogTitle>
          <DialogDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">Log consumable studio supplies into the manifest.</DialogDescription>
          <div className="pt-6"><Progress value={(step / totalSteps) * 100} className="h-1 rounded-full bg-muted" /></div>
        </DialogHeader>
        <ScrollArea className="flex-1">
            <div className={cn("pb-32", isMobile ? "p-6" : "p-8")}>
                {step === 1 && <Step1 categories={categories} onNewCategory={onNewCategory} />}
                {step === 2 && <Step2 />}
                {step === 3 && <Step3 locations={locations} onAddLocationClick={() => {}} />}
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
  return (
    <DialogContainer open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("p-0 border-none bg-background flex flex-col shadow-3xl overflow-hidden", isMobile ? "h-[92dvh] rounded-t-[2.5rem]" : "sm:max-w-4xl max-h-[90dvh]")} side="right">
        {formBody}
      </DialogContent>
    </DialogContainer>
  );
};
