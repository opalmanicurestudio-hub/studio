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
import { PlusCircle, Calendar as CalendarIcon, DollarSign, Coffee, Sparkles, ArrowRight, Pipette, CheckCircle, Check, Building, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { nanoid } from 'nanoid';

const refreshmentSchema = z.object({
  name: z.string().min(1, 'Amenity name is required.'),
  category: z.string().default('Refreshment'),
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

type RefreshmentFormData = z.infer<typeof refreshmentSchema>;

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

const Step1 = () => {
    const { register, formState: { errors } } = useFormContext<RefreshmentFormData>();
    return (
        <div className="space-y-10">
            <SectionHeader icon={Coffee} title="Identity & Menu Label" step={1} />
            <div className="space-y-6">
                <div className="space-y-2">
                    <Label htmlFor="item-name" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Guest-Facing Name</Label>
                    <Input id="item-name" placeholder="e.g., Oat Milk Espresso" {...register('name')} className="h-14 rounded-2xl border-2 font-black uppercase text-lg tracking-tight" />
                    {errors.name && <p className="text-xs font-bold text-destructive uppercase ml-1">{errors.name.message}</p>}
                </div>
                <div className="p-4 rounded-2xl border-2 border-dashed bg-primary/5 text-left">
                    <p className="text-[10px] font-bold text-primary uppercase leading-relaxed">
                        Tip: This name is exactly what guests will see in their Concierge portal. Use evocative descriptors like "Freshly Brewed" or "Artisan Blend".
                    </p>
                </div>
            </div>
        </div>
    );
};

const Step2 = () => {
    const { control, register, watch, formState: { errors } } = useFormContext<RefreshmentFormData>();
    const costingMethod = watch('costingMethod');
    return (
        <div className="space-y-10">
            <SectionHeader icon={DollarSign} title="Yield & Stock" step={2} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                <div className="space-y-6">
                    <div className="space-y-2">
                        <Label htmlFor="purchase-cost" className="text-[10px] font-black uppercase text-muted-foreground ml-1">Landed Cost (Invoice Total)</Label>
                        <div className="relative">
                            <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary" />
                            <Input id="purchase-cost" type="number" step="0.01" placeholder="0.00" {...register('purchaseCost')} className="h-14 pl-10 rounded-2xl border-2 font-black text-xl font-mono text-primary shadow-inner" />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="initial-stock" className="text-[10px] font-black uppercase text-muted-foreground ml-1">Initial Stock (Full Units)</Label>
                        <Input id="initial-stock" type="number" placeholder="e.g., 12" {...register('initialStock')} className="h-14 rounded-2xl border-2 font-black text-xl shadow-inner bg-muted/5" />
                    </div>
                </div>
                <div className="space-y-6">
                    <div className="space-y-2">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Consumption Logic</Label>
                        <Controller name="costingMethod" control={control} render={({ field }) => (
                            <RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 gap-2">
                                <label htmlFor="size-rf" className="cursor-pointer">
                                    <div className={cn("p-3 rounded-xl border-2 text-center transition-all", field.value === 'size' ? "border-primary bg-primary/5 shadow-md" : "border-border bg-background")}>
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
                        <div className="grid grid-cols-2 gap-4 animate-in slide-in-from-top-2">
                            <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Capacity</Label><Input type="number" {...register('containerSize')} className="h-11 rounded-xl border-2 font-bold" /></div>
                            <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Unit</Label>
                                <Controller name="containerUnit" control={control} render={({ field }) => (
                                    <Select onValueChange={field.onChange} value={field.value}><SelectTrigger className="h-11 rounded-xl border-2 font-bold"><SelectValue /></SelectTrigger><SelectContent className="rounded-xl"><SelectItem value="ml" className="font-bold">ML</SelectItem><SelectItem value="oz" className="font-bold">OZ</SelectItem><SelectItem value="g" className="font-bold">G</SelectItem></SelectContent></Select>
                                )}/>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-1.5 animate-in slide-in-from-top-2">
                            <Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Est. Servings / Unit</Label>
                            <Input type="number" placeholder="e.g., 25 servings" {...register('usesPerContainer')} className="h-14 rounded-2xl border-2 font-black text-xl shadow-inner bg-muted/5" />
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
};

export const AddRefreshmentDialog = ({
  open, onOpenChange, onRefreshmentAdded, locations,
}: {
  open: boolean; onOpenChange: (open: boolean) => void; onRefreshmentAdded: (item: InventoryItem) => void; locations: Location[];
}) => {
  const [step, setStep] = useState(1);
  const totalSteps = 2;
  const isMobile = useIsMobile();
  const methods = useForm<RefreshmentFormData>({ 
    resolver: zodResolver(refreshmentSchema), 
    defaultValues: { costingMethod: 'uses', initialStock: 1, category: 'Refreshment' } 
  });

  useEffect(() => { if (open) { methods.reset(); setStep(1); } }, [open, methods]);

  const { handleSubmit, trigger } = methods;
  const onSubmit = (data: RefreshmentFormData) => {
    const unitPrice = data.initialStock > 0 ? (data.purchaseCost / data.initialStock) : 0;
    onRefreshmentAdded({
      id: `refr-${nanoid(8)}`, name: data.name, type: 'refreshment', category: 'Refreshment', totalStock: data.initialStock, costPerUnit: unitPrice, supplier: data.supplier || '', primaryLocationId: data.primaryLocationId, costingMethod: data.costingMethod, size: data.containerSize, unit: data.containerUnit as any, estimatedUses: data.usesPerContainer,
      batches: [{ id: `batch-${nanoid(6)}`, stock: data.initialStock, costPerUnit: unitPrice, receivedDate: data.purchaseDate.toISOString() }],
    });
    onOpenChange(false);
  };

  const handleNext = async (e: any) => { e.preventDefault(); if (await trigger(['name'])) setStep(step + 1); };
  const handleBack = (e: any) => { e.preventDefault(); setStep(step - 1); };

  const formBody = (
    <FormProvider {...methods}>
      <form id="add-refreshment-wizard-form" onSubmit={handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
        <DialogHeader className={cn("flex-shrink-0 text-left border-b bg-muted/5", isMobile ? "p-6" : "p-8 pb-6")}>
          <div className="flex items-center gap-3 mb-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Strategic Intake</span>
          </div>
          <DialogTitle className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">Register Refreshment</DialogTitle>
          <DialogDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">Add items to your hospitality menu and asset manifest.</DialogDescription>
          <div className="pt-6"><Progress value={(step / totalSteps) * 100} className="h-1 rounded-full bg-muted" /></div>
        </DialogHeader>
        <ScrollArea className="flex-1">
            <div className={cn("pb-32", isMobile ? "p-6" : "p-8")}>
                {step === 1 && <Step1 />}
                {step === 2 && <Step2 />}
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
                <Button type="submit" className="flex-[1.5] h-12 md:h-16 font-black uppercase tracking-widest text-[10px] md:text-xl rounded-[2rem] shadow-2xl shadow-primary/30">Commit to Menu</Button>
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
