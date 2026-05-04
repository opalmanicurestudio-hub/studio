'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { InventoryDialogShell } from '@/components/inventory/InventoryDialogShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ImageUpload } from '@/components/shared/ImageUpload';
import { type InventoryItem, type Location } from '@/lib/data';
import { useForm, FormProvider, useFormContext, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Check, PlusCircle, DollarSign, Package, ShoppingCart, Calculator, Sparkles, Truck, ArrowRight, Building, FileText, Landmark, Pipette, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { nanoid } from 'nanoid';

const schema = z.object({
  name: z.string().min(1, 'Required'),
  type: z.enum(['professional', 'retail']),
  category: z.string().min(1, 'Required'),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
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
  supplier: z.string().optional(),
  sku: z.string().optional(),
  purchaseLink: z.string().optional(),
  reorderPoint: z.coerce.number().optional(),
  initialStock: z.coerce.number().min(1, 'Required'),
  primaryLocationId: z.string().optional(),
  manufacturerName: z.string().optional(),
  manufacturerContactName: z.string().optional(),
  manufacturerEmail: z.string().optional(),
  manufacturerPhone: z.string().optional(),
  manufacturingSop: z.string().optional(),
  moq: z.coerce.number().optional(),
  leadTimeDays: z.coerce.number().optional(),
});
type FormData = z.infer<typeof schema>;

const SectionHeader = ({ icon: Icon, title, step }: { icon: any; title: string; step: number }) => (
  <div className="flex items-center gap-4 mb-8">
    <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shadow-inner border border-primary/20 shrink-0"><Icon className="w-5 h-5" /></div>
    <div className="text-left"><p className="text-[9px] font-black uppercase tracking-widest text-primary/60">Module {step}</p><h3 className="text-xl font-black uppercase tracking-tighter text-slate-900">{title}</h3></div>
  </div>
);

const Step1 = ({ categories, onNewCategory }: { categories: string[]; onNewCategory: (c: string) => void }) => {
  const { register, control, setValue, formState: { errors } } = useFormContext<FormData>();
  const [adding, setAdding] = useState(false);
  const [newCat, setNewCat] = useState('');
  return (
    <div className="space-y-6">
      <SectionHeader icon={Package} title="Identity & Type" step={1} />
      <div className="space-y-2 text-left">
        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Asset Name</Label>
        <Input placeholder="e.g., Hydrating Shampoo" {...register('name')} className="h-14 rounded-2xl border-2 font-black uppercase text-lg tracking-tight" />
        {errors.name && <p className="text-xs font-bold text-destructive ml-1">{errors.name.message}</p>}
      </div>
      <Controller name="type" control={control} render={({ field }) => (
        <div className="space-y-2 text-left">
          <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Asset Classification</Label>
          <RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 gap-3">
            {[{ v: 'professional', icon: Package, label: 'Professional' }, { v: 'retail', icon: ShoppingCart, label: 'Retail' }].map(opt => (
              <label key={opt.v} htmlFor={opt.v} className="cursor-pointer">
                <div className={cn('flex flex-col items-center justify-center p-6 rounded-[2rem] border-2 transition-all', field.value === opt.v ? 'border-primary bg-primary/5 shadow-lg' : 'border-border bg-white hover:border-primary/20')}>
                  <opt.icon className={cn('mb-2 h-8 w-8', field.value === opt.v ? 'text-primary' : 'text-muted-foreground opacity-40')} />
                  <span className="text-xs font-black uppercase tracking-widest">{opt.label}</span>
                  <RadioGroupItem value={opt.v} id={opt.v} className="sr-only" />
                </div>
              </label>
            ))}
          </RadioGroup>
        </div>
      )} />
      <div className="space-y-2 text-left">
        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Department</Label>
        {adding ? (
          <div className="flex gap-2">
            <Input placeholder="New category..." value={newCat} onChange={e => setNewCat(e.target.value)} className="h-12 rounded-xl border-2 font-bold uppercase text-xs" />
            <Button type="button" className="h-12 w-12 rounded-xl" onClick={() => { if (newCat.trim()) { onNewCategory(newCat.trim()); setValue('category', newCat.trim(), { shouldValidate: true }); setAdding(false); setNewCat(''); } }}><Check className="h-5 w-5" /></Button>
          </div>
        ) : (
          <div className="flex gap-3">
            <Controller name="category" control={control} render={({ field }) => (
              <Select onValueChange={field.onChange} value={field.value}><SelectTrigger className="h-12 rounded-xl border-2 font-bold uppercase text-xs shadow-inner bg-muted/5"><SelectValue placeholder="Select a category" /></SelectTrigger><SelectContent className="rounded-xl border-2 shadow-2xl">{categories.map(c => <SelectItem key={c} value={c} className="font-bold uppercase text-[10px] tracking-widest">{c}</SelectItem>)}</SelectContent></Select>
            )} />
            <Button variant="outline" size="icon" type="button" className="h-12 w-12 rounded-xl border-2" onClick={() => setAdding(true)}><PlusCircle className="h-5 w-5" /></Button>
          </div>
        )}
        {errors.category && <p className="text-xs font-bold text-destructive ml-1">{errors.category.message}</p>}
      </div>
      <div className="space-y-2 text-left">
        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Description</Label>
        <Textarea placeholder="Guest-facing description..." {...register('description')} className="rounded-2xl border-2 bg-muted/5 min-h-[100px] p-4 font-medium" />
      </div>
      <div className="space-y-2 text-left">
        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Dossier Visual</Label>
        <Controller name="imageUrl" control={control} render={({ field }) => <ImageUpload onImageUploaded={field.onChange} />} />
      </div>
    </div>
  );
};

const Step2 = () => {
  const { control, watch, register } = useFormContext<FormData>();
  const [productType, costingMethod, totalPurchaseCost, numUnits, shippingCost, taxCost, discounts, msrp, wholesalePrice] = watch(['type', 'costingMethod', 'totalPurchaseCost', 'numUnits', 'shippingCost', 'taxCost', 'discounts', 'msrp', 'wholesalePrice']);
  const landed = useMemo(() => {
    const p = (v: any) => parseFloat(v) || 0;
    const t = p(totalPurchaseCost) + p(shippingCost) + p(taxCost) - p(discounts);
    const u = p(numUnits); return u === 0 ? 0 : t / u;
  }, [totalPurchaseCost, numUnits, shippingCost, taxCost, discounts]);
  return (
    <div className="space-y-8">
      <SectionHeader icon={Calculator} title="Yield & Costing" step={2} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start text-left">
        <Card className="border-2 rounded-[2rem] overflow-hidden shadow-sm">
          <CardHeader className="bg-muted/5 border-b p-6"><CardTitle className="text-sm font-black uppercase tracking-widest">Landed Cost Engine</CardTitle></CardHeader>
          <CardContent className="p-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Invoice Total</Label><Input type="number" placeholder="0.00" {...register('totalPurchaseCost')} className="h-11 rounded-xl border-2 font-bold" /></div>
              <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Unit Count</Label><Input type="number" placeholder="Qty" {...register('numUnits')} className="h-11 rounded-xl border-2 font-bold" /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Shipping</Label><Input type="number" placeholder="0.00" {...register('shippingCost')} className="h-11 rounded-xl border-2 font-bold" /></div>
              <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Taxes</Label><Input type="number" placeholder="0.00" {...register('taxCost')} className="h-11 rounded-xl border-2 font-bold" /></div>
            </div>
            <div className="p-4 rounded-2xl bg-primary/5 border-2 border-primary/10 flex justify-between items-center shadow-inner">
              <span className="text-[10px] font-black uppercase text-primary tracking-widest">Landed / Unit</span>
              <span className="text-2xl font-black text-primary tracking-tighter font-mono">${landed.toFixed(2)}</span>
            </div>
          </CardContent>
        </Card>
        {productType === 'professional' ? (
          <Card className="border-2 rounded-[2rem] overflow-hidden shadow-sm">
            <CardHeader className="bg-muted/5 border-b p-6"><CardTitle className="text-sm font-black uppercase tracking-widest">Professional Model</CardTitle></CardHeader>
            <CardContent className="p-6 space-y-4">
              <Controller name="costingMethod" control={control} render={({ field }) => (
                <RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 gap-2">
                  {[{ v: 'size', icon: Pipette, label: 'By Volume' }, { v: 'uses', icon: CheckCircle, label: 'By Uses' }].map(opt => (
                    <label key={opt.v} className="cursor-pointer">
                      <div className={cn('flex flex-col items-center p-3 rounded-xl border-2 transition-all', field.value === opt.v ? 'border-primary bg-primary/5 shadow-md' : 'border-border')}>
                        <opt.icon className={cn('w-4 h-4 mb-1.5', field.value === opt.v ? 'text-primary' : 'text-muted-foreground opacity-40')} />
                        <span className="text-[10px] font-black uppercase tracking-widest">{opt.label}</span>
                        <RadioGroupItem value={opt.v} className="sr-only" />
                      </div>
                    </label>
                  ))}
                </RadioGroup>
              )} />
              {costingMethod === 'size' && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Size</Label><Input type="number" placeholder="1000" {...register('containerSize')} className="h-11 rounded-xl border-2 font-bold" /></div>
                  <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Unit</Label>
                    <Controller name="containerUnit" control={control} render={({ field }) => (
                      <Select onValueChange={field.onChange} value={field.value}><SelectTrigger className="h-11 rounded-xl border-2 font-bold"><SelectValue /></SelectTrigger><SelectContent className="rounded-xl shadow-xl border-2">{['ml', 'oz', 'g'].map(u => <SelectItem key={u} value={u} className="font-bold uppercase">{u}</SelectItem>)}</SelectContent></Select>
                    )} />
                  </div>
                </div>
              )}
              {costingMethod === 'uses' && (
                <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Est. Uses / Container</Label><Input type="number" placeholder="e.g., 50" {...register('usesPerContainer')} className="h-11 rounded-xl border-2 font-bold" /></div>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card className="border-2 rounded-[2rem] overflow-hidden shadow-sm">
            <CardHeader className="bg-muted/5 border-b p-6"><CardTitle className="text-sm font-black uppercase tracking-widest">Retail Pricing Matrix</CardTitle></CardHeader>
            <CardContent className="p-6 space-y-6">
              {[{ label: 'MSRP', field: 'msrp' as const, val: msrp }, { label: 'Wholesale', field: 'wholesalePrice' as const, val: wholesalePrice }].map(row => {
                const profit = (row.val || 0) - landed;
                const margin = (row.val || 0) > 0 ? (profit / (row.val || 1)) * 100 : 0;
                return (
                  <div key={row.field} className="p-4 rounded-2xl bg-muted/10 border-2 space-y-3">
                    <div className="flex justify-between items-center"><span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{row.label}</span><div className="relative w-32"><DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-primary" /><Input type="number" placeholder="0.00" {...register(row.field)} className="h-10 pl-7 rounded-xl border-2 font-black text-primary font-mono" /></div></div>
                    <div className="flex justify-between items-center text-[10px] font-bold uppercase pt-2 border-t border-dashed"><span className="opacity-60">Profit / Margin</span><span className={cn('font-black font-mono text-sm', profit >= 0 ? 'text-primary' : 'text-destructive')}>${profit.toFixed(2)} ({margin.toFixed(0)}%)</span></div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

const Step3 = ({ onAddLocationClick, locations }: { onAddLocationClick: () => void; locations: Location[] }) => {
  const { register, control, formState: { errors } } = useFormContext<FormData>();
  return (
    <div className="space-y-8">
      <SectionHeader icon={Truck} title="Logistics & Continuity" step={3} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start text-left">
        <div className="space-y-6">
          <Card className="border-2 rounded-[2rem] overflow-hidden shadow-sm">
            <CardHeader className="bg-muted/5 border-b p-5"><CardTitle className="text-sm font-black uppercase tracking-widest flex items-center gap-2"><Building className="w-4 h-4 text-primary" /> Manufacturing Vault</CardTitle></CardHeader>
            <CardContent className="p-5 space-y-3">
              <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Manufacturer Name</Label><Input placeholder="e.g., Global Formula Labs" {...register('manufacturerName')} className="h-11 rounded-xl border-2 font-bold" /></div>
              <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Contact Name</Label><Input placeholder="Account Manager" {...register('manufacturerContactName')} className="h-11 rounded-xl border-2 font-bold" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Email</Label><Input type="email" placeholder="rep@mfg.com" {...register('manufacturerEmail')} className="h-11 rounded-xl border-2 font-bold text-xs" /></div>
                <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Phone</Label><Input placeholder="555-000-0000" {...register('manufacturerPhone')} className="h-11 rounded-xl border-2 font-bold text-xs" /></div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-2 rounded-[2rem] overflow-hidden shadow-sm">
            <CardHeader className="bg-muted/5 border-b p-5"><CardTitle className="text-sm font-black uppercase tracking-widest flex items-center gap-2"><Landmark className="w-4 h-4 text-primary" /> Wholesale Matrix</CardTitle></CardHeader>
            <CardContent className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Min Order (MOQ)</Label><Input type="number" placeholder="50" {...register('moq')} className="h-11 rounded-xl border-2 font-bold" /></div>
                <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Lead Time (Days)</Label><Input type="number" placeholder="14" {...register('leadTimeDays')} className="h-11 rounded-xl border-2 font-bold" /></div>
              </div>
              <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Reorder URL</Label><Input placeholder="https://..." {...register('purchaseLink')} className="h-11 rounded-xl border-2 font-bold text-xs" /></div>
            </CardContent>
          </Card>
        </div>
        <div className="space-y-6">
          <Card className="border-2 rounded-[2rem] overflow-hidden shadow-sm">
            <CardHeader className="bg-muted/5 border-b p-5"><CardTitle className="text-sm font-black uppercase tracking-widest flex items-center gap-2"><FileText className="w-4 h-4 text-primary opacity-40" /> SOP Notes</CardTitle></CardHeader>
            <CardContent className="p-5"><Textarea placeholder="Detail the exact technical protocol..." {...register('manufacturingSop')} className="rounded-xl border-2 bg-muted/5 min-h-[160px] font-medium" /></CardContent>
          </Card>
          <Card className="border-2 rounded-[2rem] overflow-hidden shadow-sm">
            <CardHeader className="bg-muted/5 border-b p-5"><CardTitle className="text-sm font-black uppercase tracking-widest">Registry & Stock</CardTitle></CardHeader>
            <CardContent className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Starting Stock</Label><Input type="number" placeholder="Qty" {...register('initialStock')} className="h-11 rounded-xl border-2 font-black text-lg" />{errors.initialStock && <p className="text-[8px] font-black text-destructive">{errors.initialStock.message}</p>}</div>
                <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">SKU</Label><Input placeholder="Registry ID" {...register('sku')} className="h-11 rounded-xl border-2 font-mono font-black" /></div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Placement Zone</Label>
                <div className="flex gap-2">
                  <Controller name="primaryLocationId" control={control} render={({ field }) => (
                    <Select onValueChange={field.onChange} value={field.value}><SelectTrigger className="h-11 rounded-xl border-2 font-bold uppercase text-[10px] tracking-widest flex-1 bg-muted/5 shadow-inner"><SelectValue placeholder="Select Zone" /></SelectTrigger><SelectContent className="rounded-xl border-2 shadow-2xl">{locations.map(l => <SelectItem key={l.id} value={l.id} className="font-bold uppercase text-[9px] tracking-widest">{l.name}</SelectItem>)}</SelectContent></Select>
                  )} />
                  <Button variant="outline" size="icon" type="button" onClick={onAddLocationClick} className="h-11 w-11 rounded-xl border-2 shrink-0"><PlusCircle className="h-5 w-5" /></Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export const AddProductDialog: React.FC<{
  open: boolean; onOpenChange: (o: boolean) => void;
  initialType: 'professional' | 'retail';
  categories: string[]; onNewCategory: (c: string) => void;
  onProductAdded: (p: InventoryItem) => void;
  locations: Location[]; onAddLocationClick: () => void;
}> = ({ open, onOpenChange, initialType, categories, onNewCategory, onProductAdded, locations, onAddLocationClick }) => {
  const [step, setStep] = useState(1);
  const STEPS = 3;
  const methods = useForm<FormData>({ resolver: zodResolver(schema), defaultValues: { type: initialType, costingMethod: 'size', initialStock: 1 } });

  useEffect(() => { if (open) { methods.reset({ type: initialType, costingMethod: 'size', initialStock: 1 }); setStep(1); } }, [open, initialType, methods]);

  const { trigger, handleSubmit } = methods;

  const onSubmit = (data: FormData) => {
    const costPerUnit = (data.numUnits || 1) > 0 ? ((data.totalPurchaseCost || 0) + (data.shippingCost || 0) + (data.taxCost || 0) - (data.discounts || 0)) / (data.numUnits || 1) : 0;
    onProductAdded({ id: `prod-${nanoid(8)}`, name: data.name, type: data.type, category: data.category, description: data.description, totalStock: data.initialStock || 0, supplier: data.supplier || '', supplierUrl: data.purchaseLink, costPerUnit, reorderPoint: data.reorderPoint, imageUrl: data.imageUrl, primaryLocationId: data.primaryLocationId, costingMethod: data.costingMethod, size: data.containerSize, unit: data.containerUnit as any, estimatedUses: data.usesPerContainer, msrp: data.msrp, restockingMarkup: data.restockingMarkup, manufacturerName: data.manufacturerName, manufacturerContactName: data.manufacturerContactName, manufacturerEmail: data.manufacturerEmail, manufacturerPhone: data.manufacturerPhone, manufacturingSop: data.manufacturingSop, moq: data.moq, leadTimeDays: data.leadTimeDays, batches: [{ id: `batch-${nanoid(6)}`, stock: data.initialStock || 0, costPerUnit, receivedDate: new Date().toISOString() }] });
    onOpenChange(false);
  };

  const goNext = async (e: React.MouseEvent) => {
    e.preventDefault();
    const fields: (keyof FormData)[] = [];
    if (step === 1) fields.push('name', 'category');
    if (step === 3) fields.push('initialStock');
    if (fields.length === 0 || await trigger(fields)) { if (step < STEPS) setStep(s => s + 1); }
  };
  const goBack = (e: React.MouseEvent) => { e.preventDefault(); if (step > 1) setStep(s => s - 1); };

  return (
    <InventoryDialogShell open={open} onOpenChange={onOpenChange}>
      <FormProvider {...methods}>
        <form onSubmit={handleSubmit(onSubmit)} className="h-full flex flex-col">
          <div className="flex-shrink-0 border-b bg-muted/5 px-8 py-6">
            <div className="flex items-center gap-3 mb-2"><PlusCircle className="w-5 h-5 text-primary" /><span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Strategic Intake</span></div>
            <h2 className="text-2xl sm:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">Add New Asset</h2>
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">Register a {initialType} item into your studio manifest.</p>
            <div className="mt-5"><Progress value={(step / STEPS) * 100} className="h-1 rounded-full bg-muted" /></div>
          </div>

          <ScrollArea className="flex-1 min-h-0">
            <div className="px-8 py-8 pb-10">
              {step === 1 && <Step1 categories={categories} onNewCategory={onNewCategory} />}
              {step === 2 && <Step2 />}
              {step === 3 && <Step3 onAddLocationClick={onAddLocationClick} locations={locations} />}
            </div>
          </ScrollArea>

          <div className="flex-shrink-0 border-t bg-background px-8 py-5 shadow-md">
            <div className="flex w-full gap-3">
              {step > 1 && <Button variant="ghost" type="button" onClick={goBack} className="flex-1 h-14 rounded-2xl font-black uppercase text-[10px] tracking-widest text-slate-400">Back</Button>}
              <div className={cn('flex gap-3', step === 1 ? 'w-full' : 'flex-[2.5]')}>
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