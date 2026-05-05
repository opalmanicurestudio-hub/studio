'use client';

import React, { useState, useEffect } from 'react';
import { InventoryDialogShell } from '@/components/inventory/InventoryDialogShell';
import { ArrowRight, PlusCircle, DollarSign, Calendar as CalendarIcon, Recycle, Sparkles, Check, Building, Pipette, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useForm, Controller, FormProvider, useFormContext } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { nanoid } from 'nanoid';
import { type InventoryItem, type Location } from '@/lib/data';

const schema = z.object({
  name: z.string().min(1, 'Required'),
  category: z.string().min(1, 'Required'),
  description: z.string().optional(),
  purchaseCost: z.coerce.number().min(0),
  purchaseDate: z.date({ required_error: 'Required' }),
  costingMethod: z.enum(['size', 'uses']),
  containerSize: z.coerce.number().optional(),
  containerUnit: z.string().optional(),
  usesPerContainer: z.coerce.number().optional(),
  initialStock: z.coerce.number().min(1, 'Required'),
  supplier: z.string().optional(),
  primaryLocationId: z.string().optional(),
});
type FormData = z.infer<typeof schema>;

const SectionHeader = ({ icon: Icon, title, step }: { icon: any; title: string; step: number }) => (
  <div className="flex items-center gap-4 mb-8 text-left">
    <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shadow-inner border border-primary/20 shrink-0"><Icon className="w-5 h-5" /></div>
    <div><p className="text-[9px] font-black uppercase tracking-widest text-primary/60">Module {step}</p><h3 className="text-xl font-black uppercase tracking-tighter text-slate-900">{title}</h3></div>
  </div>
);

const Step1 = ({ cats, onNewCat }: { cats: string[]; onNewCat: (c: string) => void }) => {
  const { control, register, setValue, formState: { errors } } = useFormContext<FormData>();
  const [adding, setAdding] = useState(false);
  const [newCat, setNewCat] = useState('');
  return (
    <div className="space-y-6 text-left">
      <SectionHeader icon={Recycle} title="Identity & Consumable" step={1} />
      <div className="space-y-2">
        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Asset Label</Label>
        <Input placeholder="e.g., Disinfectant Wipes" {...register('name')} className="h-14 rounded-2xl border-2 font-black uppercase text-lg tracking-tight" />
        {errors.name && <p className="text-xs font-bold text-destructive ml-1">{errors.name.message}</p>}
      </div>
      <div className="space-y-2">
        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Department</Label>
        {adding ? (
          <div className="flex gap-2">
            <Input placeholder="New category..." value={newCat} onChange={e => setNewCat(e.target.value)} className="h-12 rounded-xl border-2 font-bold uppercase text-xs" />
            <Button type="button" className="h-12 w-12 rounded-xl" onClick={() => { if (newCat.trim()) { onNewCat(newCat.trim()); setValue('category', newCat.trim()); setAdding(false); setNewCat(''); } }}><Check className="h-5 w-5" /></Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Controller name="category" control={control} render={({ field }) => (
              <Select onValueChange={field.onChange} value={field.value}><SelectTrigger className="h-12 rounded-xl border-2 font-bold uppercase text-xs shadow-inner bg-muted/5"><SelectValue placeholder="Select category" /></SelectTrigger><SelectContent className="rounded-xl border-2 shadow-2xl">{cats.map(c => <SelectItem key={c} value={c} className="font-bold uppercase text-[10px] tracking-widest">{c}</SelectItem>)}</SelectContent></Select>
            )} />
            <Button variant="outline" size="icon" type="button" className="h-12 w-12 rounded-xl border-2" onClick={() => setAdding(true)}><PlusCircle className="h-5 w-5" /></Button>
          </div>
        )}
      </div>
      <div className="space-y-2">
        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Description</Label>
        <Textarea placeholder="Internal details..." {...register('description')} className="rounded-2xl border-2 bg-muted/5 min-h-[100px] p-4 font-medium" />
      </div>
    </div>
  );
};

const Step2 = () => {
  const { control, register, watch } = useFormContext<FormData>();
  const method = watch('costingMethod');
  return (
    <div className="space-y-6 text-left">
      <SectionHeader icon={DollarSign} title="Yield & Costing" step={2} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
        <div className="space-y-6">
          <div className="space-y-2">
            <Label className="text-[10px] font-black uppercase text-muted-foreground ml-1">Total Payout</Label>
            <div className="relative"><DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary" /><Input type="number" step="0.01" placeholder="0.00" {...register('purchaseCost')} className="h-14 pl-10 rounded-2xl border-2 font-black text-xl font-mono text-primary shadow-inner" /></div>
          </div>
          <div className="space-y-2">
            <Label className="text-[10px] font-black uppercase text-muted-foreground ml-1">Unit Count (Containers)</Label>
            <Input type="number" placeholder="e.g., 12" {...register('initialStock')} className="h-14 rounded-2xl border-2 font-black text-xl shadow-inner bg-muted/5 text-center" />
          </div>
        </div>
        <div className="space-y-6">
          <div className="space-y-2">
            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Consumption Logic</Label>
            <Controller name="costingMethod" control={control} render={({ field }) => (
              <RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 gap-2">
                {[{ v: 'size', icon: Pipette, label: 'By Volume' }, { v: 'uses', icon: CheckCircle, label: 'By Uses' }].map(opt => (
                  <label key={opt.v} className="cursor-pointer">
                    <div className={cn('p-3 rounded-xl border-2 text-center transition-all', field.value === opt.v ? 'border-primary bg-primary/5 shadow-md' : 'border-border bg-background')}>
                      <opt.icon className={cn('w-4 h-4 mx-auto mb-1.5', field.value === opt.v ? 'text-primary' : 'text-muted-foreground opacity-40')} />
                      <span className="text-[10px] font-black uppercase tracking-widest">{opt.label}</span>
                      <RadioGroupItem value={opt.v} className="sr-only" />
                    </div>
                  </label>
                ))}
              </RadioGroup>
            )} />
          </div>
          {method === 'size' ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Size</Label><Input type="number" {...register('containerSize')} className="h-11 rounded-xl border-2 font-bold" /></div>
              <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Unit</Label>
                <Controller name="containerUnit" control={control} render={({ field }) => (
                  <Select onValueChange={field.onChange} value={field.value}><SelectTrigger className="h-11 rounded-xl border-2 font-bold"><SelectValue /></SelectTrigger><SelectContent className="rounded-xl shadow-xl border-2">{['ml', 'oz', 'g', 'sheets'].map(u => <SelectItem key={u} value={u} className="font-bold uppercase">{u}</SelectItem>)}</SelectContent></Select>
                )} />
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Est. Uses / Container</Label>
              <Input type="number" placeholder="e.g., 100 wipes" {...register('usesPerContainer')} className="h-14 rounded-2xl border-2 font-black text-xl shadow-inner bg-muted/5 text-center" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const Step3 = ({ locations }: { locations: Location[] }) => {
  const { register, control } = useFormContext<FormData>();
  return (
    <div className="space-y-6 text-left">
      <SectionHeader icon={Building} title="Logistics & Zone" step={3} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Primary Zone</Label>
            <Controller name="primaryLocationId" control={control} render={({ field }) => (
              <Select onValueChange={field.onChange} value={field.value}><SelectTrigger className="h-11 rounded-xl border-2 font-bold uppercase text-[10px] tracking-widest bg-muted/5 shadow-inner"><SelectValue placeholder="Select Zone" /></SelectTrigger><SelectContent className="rounded-xl border-2 shadow-2xl">{locations.map(l => <SelectItem key={l.id} value={l.id} className="font-bold uppercase text-[9px] tracking-widest">{l.name}</SelectItem>)}</SelectContent></Select>
            )} />
          </div>
          <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Source / Supplier</Label><Input placeholder="e.g., Uline" {...register('supplier')} className="h-11 rounded-xl border-2 font-bold" /></div>
        </div>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground ml-1">Intake Date</Label>
            <Controller name="purchaseDate" control={control} render={({ field }) => (
              <Popover><PopoverTrigger asChild>
                <Button variant="outline" className="w-full h-11 rounded-xl border-2 font-bold justify-start px-4 text-xs bg-muted/5"><CalendarIcon className="mr-2 h-4 w-4 opacity-40" />{field.value ? format(field.value, 'MMM d, yyyy') : 'Pick a date'}</Button>
              </PopoverTrigger><PopoverContent className="w-auto p-0 rounded-3xl overflow-hidden shadow-3xl border-4"><Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus /></PopoverContent></Popover>
            )} />
          </div>
        </div>
      </div>
    </div>
  );
};

export const AddOverheadDialog = ({
  open, onOpenChange, categories, onNewCategory, onOverheadAdded, locations,
}: {
  open: boolean; onOpenChange: (o: boolean) => void;
  categories: string[]; onNewCategory: (c: string) => void;
  onOverheadAdded: (item: InventoryItem) => void;
  locations: Location[];
}) => {
  const [step, setStep] = useState(1);
  const STEPS = 3;
  const methods = useForm<FormData>({ resolver: zodResolver(schema), defaultValues: { costingMethod: 'uses', initialStock: 1 } });
  const { handleSubmit, trigger, reset } = methods;

  useEffect(() => { if (open) { reset({ costingMethod: 'uses', initialStock: 1, purchaseDate: new Date() }); setStep(1); } }, [open, reset]);

  const onSubmit = (data: FormData) => {
    const ppu = data.initialStock > 0 ? data.purchaseCost / data.initialStock : 0;
    onOverheadAdded({ id: `ovhd-${nanoid(8)}`, name: data.name, description: data.description, type: 'overhead', category: data.category, totalStock: data.initialStock, costPerUnit: ppu, supplier: data.supplier || '', primaryLocationId: data.primaryLocationId, costingMethod: data.costingMethod, size: data.containerSize, unit: data.containerUnit as any, estimatedUses: data.usesPerContainer, batches: [{ id: `batch-${nanoid(6)}`, stock: data.initialStock, costPerUnit: ppu, receivedDate: data.purchaseDate.toISOString() }] });
    onOpenChange(false);
  };

  const goNext = async (e: React.MouseEvent) => { e.preventDefault(); if (await trigger(step === 1 ? ['name', 'category'] : [])) setStep(s => s + 1); };
  const goBack = (e: React.MouseEvent) => { e.preventDefault(); setStep(s => s - 1); };

  return (
    <InventoryDialogShell open={open} onOpenChange={onOpenChange}>
      <FormProvider {...methods}>
        <form onSubmit={handleSubmit(onSubmit)} className="h-full flex flex-col">
          <div className="flex-shrink-0 border-b bg-muted/5 px-8 py-6">
            <div className="flex items-center gap-3 mb-2"><Sparkles className="w-5 h-5 text-primary" /><span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Strategic Intake</span></div>
            <h2 className="text-2xl sm:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">Register Overhead Supply</h2>
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">Log consumable studio supplies into the manifest.</p>
            <div className="mt-5"><Progress value={(step / STEPS) * 100} className="h-1 rounded-full bg-muted" /></div>
          </div>

          <ScrollArea className="flex-1 min-h-0">
            <div className="px-8 py-8 pb-10">
              {step === 1 && <Step1 cats={categories} onNewCat={onNewCategory} />}
              {step === 2 && <Step2 />}
              {step === 3 && <Step3 locations={locations} />}
            </div>
          </ScrollArea>

          <div className="flex-shrink-0 border-t bg-background px-8 py-5 shadow-md">
            <div className="flex w-full gap-3">
              {step > 1 && <Button variant="ghost" type="button" onClick={goBack} className="flex-1 h-14 rounded-2xl font-black uppercase text-[10px] tracking-widest text-slate-400">Back</Button>}
              <div className={step === 1 ? 'flex gap-3 w-full' : 'flex gap-3 flex-[2.5]'}>
                <Button variant="outline" type="button" onClick={() => onOpenChange(false)} className="flex-1 h-14 rounded-2xl font-black uppercase tracking-widest text-[10px] border-2">Cancel</Button>
                {step < STEPS
                  ? <Button type="button" onClick={goNext} className="flex-[1.5] h-14 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-2xl shadow-primary/30 group">Continue <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1" /></Button>
                  : <Button type="submit" className="flex-[1.5] h-14 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-2xl shadow-primary/30">Save Asset</Button>
                }
              </div>
            </div>
          </div>
        </form>
      </FormProvider>
    </InventoryDialogShell>
  );
};