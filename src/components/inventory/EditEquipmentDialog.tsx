'use client';

import React, { useState, useEffect } from 'react';
import { InventoryDialogShell } from '@/components/inventory/InventoryDialogShell';
import { ArrowRight, PlusCircle, DollarSign, Calendar as CalendarIcon, Hammer, Sparkles, Check, Building, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useForm, Controller, FormProvider, useFormContext } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format, parseISO } from 'date-fns';
import { ImageUpload } from '@/components/shared/ImageUpload';
import { type InventoryItem, type Location } from '@/lib/data';

const schema = z.object({
  name:              z.string().min(1, 'Required'),
  category:          z.string().min(1, 'Required'),
  description:       z.string().optional(),
  purchaseCost:      z.coerce.number().min(0),
  lifespanYears:     z.coerce.number().min(0),
  purchaseDate:      z.date({ required_error: 'Required' }),
  quantity:          z.coerce.number().min(1).default(1),
  supplier:          z.string().optional(),
  supplierUrl:       z.string().optional(),
  primaryLocationId: z.string().optional(),
  imageUrl:          z.string().optional(),
  sku:               z.string().optional(),
});
type FormData = z.infer<typeof schema>;

const SH = ({ icon: Icon, title, step }: { icon: any; title: string; step: number }) => (
  <div className="flex items-center gap-4 mb-8 text-left">
    <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shadow-inner border border-primary/20 shrink-0">
      <Icon className="w-5 h-5" />
    </div>
    <div>
      <p className="text-[9px] font-black uppercase tracking-widest text-primary/60">Module {step}</p>
      <h3 className="text-xl font-black uppercase tracking-tighter text-slate-900">{title}</h3>
    </div>
  </div>
);

const Step1 = ({ cats, onNewCat }: { cats: string[]; onNewCat: (c: string) => void }) => {
  const { control, register, setValue, formState: { errors } } = useFormContext<FormData>();
  const [adding, setAdding] = useState(false);
  const [newCat, setNewCat] = useState('');
  return (
    <div className="space-y-6 text-left">
      <SH icon={Hammer} title="Identity & Category" step={1} />
      <div className="space-y-2">
        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Asset Label</Label>
        <Input placeholder="e.g., Hydraulic Styling Chair" {...register('name')} className="h-14 rounded-2xl border-2 font-black uppercase text-lg tracking-tight" />
        {errors.name && <p className="text-xs font-bold text-destructive ml-1">{errors.name.message}</p>}
      </div>
      <div className="space-y-2">
        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Department</Label>
        {adding ? (
          <div className="flex gap-2">
            <Input placeholder="New category..." value={newCat} onChange={e => setNewCat(e.target.value)} className="h-12 rounded-xl border-2 font-bold uppercase text-xs" />
            <Button type="button" className="h-12 w-12 rounded-xl" onClick={() => { if (newCat.trim()) { onNewCat(newCat.trim()); setValue('category', newCat.trim()); setAdding(false); setNewCat(''); } }}>
              <Check className="h-5 w-5" />
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Controller name="category" control={control} render={({ field }) => (
              <Select onValueChange={field.onChange} value={field.value}>
                <SelectTrigger className="h-12 rounded-xl border-2 font-bold uppercase text-xs shadow-inner bg-muted/5">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-2 shadow-2xl">
                  {cats.map(c => <SelectItem key={c} value={c} className="font-bold uppercase text-[10px] tracking-widest">{c}</SelectItem>)}
                </SelectContent>
              </Select>
            )} />
            <Button variant="outline" size="icon" type="button" className="h-12 w-12 rounded-xl border-2" onClick={() => setAdding(true)}>
              <PlusCircle className="h-5 w-5" />
            </Button>
          </div>
        )}
      </div>
      <div className="space-y-2">
        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Description</Label>
        <Textarea placeholder="Guest-facing details..." {...register('description')} className="rounded-2xl border-2 bg-muted/5 min-h-[100px] p-4 font-medium" />
      </div>
      <div className="space-y-2">
        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">SKU</Label>
        <Input placeholder="Hardware identifier..." {...register('sku')} className="h-12 rounded-xl border-2 font-mono font-black uppercase text-sm" />
      </div>
      <div className="space-y-2">
        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Asset Visual</Label>
        <Controller name="imageUrl" control={control} render={({ field }) => <ImageUpload onImageUploaded={field.onChange} currentImageUrl={field.value} />} />
      </div>
    </div>
  );
};

const Step2 = () => {
  const { control, register } = useFormContext<FormData>();
  return (
    <div className="space-y-6 text-left">
      <SH icon={DollarSign} title="Capital Investment" step={2} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
        <div className="space-y-6">
          <div className="space-y-2">
            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Purchase Cost (Per Unit)</Label>
            <div className="relative">
              <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary" />
              <Input type="number" step="0.01" placeholder="0.00" {...register('purchaseCost')} className="h-14 pl-10 rounded-2xl border-2 font-black text-xl font-mono text-primary shadow-inner" />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Unit Count</Label>
            <Input type="number" placeholder="1" {...register('quantity')} className="h-12 rounded-xl border-2 font-black text-lg shadow-inner bg-muted/5 text-center" />
          </div>
        </div>
        <div className="space-y-6">
          <div className="space-y-2">
            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Depreciation Lifecycle (Years)</Label>
            <Input type="number" placeholder="e.g., 5" {...register('lifespanYears')} className="h-14 rounded-2xl border-2 font-black text-xl" />
          </div>
          <div className="space-y-2">
            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Investment Date</Label>
            <Controller name="purchaseDate" control={control} render={({ field }) => (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full h-12 rounded-xl border-2 font-bold justify-start px-4 text-xs bg-muted/5">
                    <CalendarIcon className="mr-2 h-4 w-4 opacity-40" />
                    {field.value ? format(field.value, 'MMM d, yyyy') : 'Pick a date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 rounded-3xl overflow-hidden shadow-3xl border-4">
                  <Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus />
                </PopoverContent>
              </Popover>
            )} />
          </div>
        </div>
      </div>
    </div>
  );
};

const Step3 = ({ locations }: { locations: Location[] }) => {
  const { register, control } = useFormContext<FormData>();
  return (
    <div className="space-y-6 text-left">
      <SH icon={Building} title="Logistics & Source" step={3} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Supplier</Label>
            <Input placeholder="e.g., Belvedere" {...register('supplier')} className="h-11 rounded-xl border-2 font-bold" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Reorder URL</Label>
            <Input placeholder="https://..." {...register('supplierUrl')} className="h-11 rounded-xl border-2 font-bold text-xs" />
          </div>
        </div>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Primary Zone</Label>
            <Controller name="primaryLocationId" control={control} render={({ field }) => (
              <Select onValueChange={field.onChange} value={field.value}>
                <SelectTrigger className="h-11 rounded-xl border-2 font-bold uppercase text-[10px] tracking-widest bg-muted/5 shadow-inner">
                  <SelectValue placeholder="Select Zone" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-2 shadow-2xl">
                  {locations.map(l => <SelectItem key={l.id} value={l.id} className="font-bold uppercase text-[9px] tracking-widest">{l.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )} />
          </div>
        </div>
      </div>
    </div>
  );
};

export const EditEquipmentDialog = ({
  open, onOpenChange, onEquipmentUpdated, equipment, equipmentCategories, onNewCategory, locations,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onEquipmentUpdated: (e: InventoryItem) => void;
  equipment: InventoryItem;
  equipmentCategories: string[];
  onNewCategory: (c: string) => void;
  locations: Location[];
}) => {
  const [step, setStep] = useState(1);
  const STEPS = 3;

  const getDefaultDate = () => {
    try {
      const batch = equipment?.batches?.[0]?.receivedDate;
      return batch ? parseISO(batch) : new Date();
    } catch {
      return new Date();
    }
  };

  const methods = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name:              equipment?.name || '',
      category:          equipment?.category || '',
      description:       equipment?.description || '',
      purchaseCost:      equipment?.costPerUnit || 0,
      lifespanYears:     equipment?.lifespanYears || 5,
      purchaseDate:      getDefaultDate(),
      quantity:          1,
      supplier:          equipment?.supplier || '',
      supplierUrl:       equipment?.supplierUrl || '',
      primaryLocationId: equipment?.primaryLocationId || '',
      imageUrl:          equipment?.imageUrl || '',
      sku:               equipment?.sku || '',
    },
  });
  const { handleSubmit, reset, trigger } = methods;

  useEffect(() => {
    if (open && equipment) {
      reset({
        name:              equipment.name || '',
        category:          equipment.category || '',
        description:       equipment.description || '',
        purchaseCost:      equipment.costPerUnit || 0,
        lifespanYears:     equipment.lifespanYears || 5,
        purchaseDate:      getDefaultDate(),
        quantity:          1,
        supplier:          equipment.supplier || '',
        supplierUrl:       equipment.supplierUrl || '',
        primaryLocationId: equipment.primaryLocationId || '',
        imageUrl:          equipment.imageUrl || '',
        sku:               equipment.sku || '',
      });
      setStep(1);
    }
  }, [open, equipment, reset]);

  const onSubmit = (data: FormData) => {
    onEquipmentUpdated({
      ...equipment,
      name:              data.name,
      category:          data.category,
      description:       data.description,
      costPerUnit:       data.purchaseCost,
      lifespanYears:     data.lifespanYears,
      supplier:          data.supplier || '',
      supplierUrl:       data.supplierUrl,
      primaryLocationId: data.primaryLocationId,
      imageUrl:          data.imageUrl,
      sku:               data.sku,
    });
    onOpenChange(false);
  };

  const goNext = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (await trigger(step === 1 ? ['name', 'category'] : [])) setStep(s => s + 1);
  };
  const goBack = (e: React.MouseEvent) => {
    e.preventDefault();
    setStep(s => s - 1);
  };

  const backBtnClass = "flex-1 h-14 rounded-2xl font-black uppercase text-[10px] tracking-widest text-slate-400";
  const innerDivClass = step === 1 ? "flex gap-3 w-full" : "flex gap-3 flex-[2.5]";

  return (
    <InventoryDialogShell open={open} onOpenChange={onOpenChange}>
      <FormProvider {...methods}>
        <form onSubmit={handleSubmit(onSubmit)} className="h-full flex flex-col">

          <div className="flex-shrink-0 border-b bg-muted/5 px-8 py-6">
            <div className="flex items-center gap-3 mb-2">
              <Sparkles className="w-5 h-5 text-primary" />
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Asset Editor</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">Edit Capital Asset</h2>
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">{equipment?.name}</p>
            <div className="mt-5">
              <Progress value={(step / STEPS) * 100} className="h-1 rounded-full bg-muted" />
            </div>
          </div>

          <ScrollArea className="flex-1 min-h-0">
            <div className="px-8 py-8 pb-10">
              {step === 1 && <Step1 cats={equipmentCategories} onNewCat={onNewCategory} />}
              {step === 2 && <Step2 />}
              {step === 3 && <Step3 locations={locations} />}
            </div>
          </ScrollArea>

          <div className="flex-shrink-0 border-t bg-background px-8 py-5 shadow-md">
            <div className="flex w-full gap-3">
              {step > 1 && (
                <Button variant="ghost" type="button" onClick={goBack} className={backBtnClass}>
                  Back
                </Button>
              )}
              <div className={innerDivClass}>
                <Button variant="outline" type="button" onClick={() => onOpenChange(false)} className="flex-1 h-14 rounded-2xl font-black uppercase tracking-widest text-[10px] border-2">
                  Cancel
                </Button>
                {step < STEPS ? (
                  <Button type="button" onClick={goNext} className="flex-[1.5] h-14 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-2xl shadow-primary/30 group">
                    Continue <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1" />
                  </Button>
                ) : (
                  <Button type="submit" className="flex-[1.5] h-14 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-2xl shadow-primary/30">
                    <Save className="mr-2 w-4 h-4" /> Save Changes
                  </Button>
                )}
              </div>
            </div>
          </div>

        </form>
      </FormProvider>
    </InventoryDialogShell>
  );
};