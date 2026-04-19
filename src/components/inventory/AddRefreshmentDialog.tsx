'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Sheet, SheetContent,
} from '@/components/ui/sheet';
import {
  PlusCircle, Calendar as CalendarIcon, DollarSign, Coffee,
  ArrowRight, Check, Building, Trash2, Activity, FlaskConical,
  ChevronDown, ChevronUp, Package, Sparkles, Lock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useForm, Controller, FormProvider, useFormContext } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { type InventoryItem, type Location } from '@/lib/data';
import { Calendar } from '../ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { cn, safeNumber } from '@/lib/utils';
import { format } from 'date-fns';
import { ScrollArea } from '../ui/scroll-area';
import { Progress } from '../ui/progress';
import { nanoid } from 'nanoid';
import { ImageUpload } from '../shared/ImageUpload';
import { BrowseProductsDialog } from '../services/BrowseProductsDialog';
import { useInventory } from '@/context/InventoryContext';
import { Switch } from '../ui/switch';
import { Badge } from '../ui/badge';

// ─── SCHEMA ───────────────────────────────────────────────────────────────────
const refreshmentSchema = z.object({
  name:             z.string().min(1, 'Name is required'),
  description:      z.string().optional(),
  category:         z.string().default('Artisanal Beverages'),
  price:            z.coerce.number().min(0).default(0),
  showInConcierge:  z.boolean().default(true),
  isMembersOnly:    z.boolean().default(false),
  purchaseCost:     z.coerce.number().min(0),
  purchaseDate:     z.date({ required_error: 'Intake date is required' }),
  trackingMethod:   z.enum(['volume', 'servings']),
  containerSize:    z.coerce.number().optional(),
  containerUnit:    z.string().optional(),
  servingsPerUnit:  z.coerce.number().optional(),
  currentStock:     z.coerce.number().min(0, 'Stock must be 0 or more'),
  supplier:         z.string().optional(),
  primaryLocationId: z.string().optional(),
  imageUrl:         z.string().optional(),
  hasRecipe:        z.boolean().default(false),
  formula:          z.array(z.object({
    id:           z.string(),
    name:         z.string(),
    quantityUsed: z.coerce.number(),
    unit:         z.string(),
    costPerUnit:  z.coerce.number().optional(),
  })).optional(),
});

type RefreshmentFormData = z.infer<typeof refreshmentSchema>;

// ─── STEP HEADER ──────────────────────────────────────────────────────────────
const StepHeader = ({ icon: Icon, title, subtitle, step }: {
  icon: any; title: string; subtitle: string; step: number;
}) => (
  <div className="flex items-start gap-4 mb-8">
    <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
      <Icon className="w-5 h-5" />
    </div>
    <div>
      <p className="text-[9px] font-black uppercase tracking-widest text-primary/60 mb-0.5">Step {step} of 2</p>
      <h3 className="text-xl font-black uppercase tracking-tighter text-slate-900">{title}</h3>
      <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>
    </div>
  </div>
);

// ─── FIELD LABEL ──────────────────────────────────────────────────────────────
const FieldLabel = ({ children, required }: { children: React.ReactNode; required?: boolean }) => (
  <Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">
    {children}{required && <span className="text-primary ml-0.5">*</span>}
  </Label>
);

// ─── STEP 1: What is it? ──────────────────────────────────────────────────────
const Step1 = () => {
  const { register, control, setValue, formState: { errors } } = useFormContext<RefreshmentFormData>();
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName]   = useState('');

  const categories = [
    'Artisanal Beverages', 'Premium Spirits', 'Gourmet Snacks',
    'Comfort & Environment', 'Tech & Utility', 'Seasonal Special', 'Healthy Essentials',
  ];

  return (
    <div className="space-y-6">
      <StepHeader icon={Coffee} title="What is it?" subtitle="Name, category, image, and how it appears to guests." step={1} />

      {/* Name */}
      <div className="space-y-1.5">
        <FieldLabel required>Name</FieldLabel>
        <Input {...register('name')} placeholder="e.g. Oat Milk Espresso" className="h-12 rounded-xl border-2 font-bold text-base" />
        {errors.name && <p className="text-[10px] font-bold text-red-500">{errors.name.message}</p>}
      </div>

      {/* Category */}
      <div className="space-y-1.5">
        <FieldLabel>Category</FieldLabel>
        {isAddingCategory ? (
          <div className="flex gap-2">
            <Input placeholder="New category name…" value={newCategoryName}
              onChange={e => setNewCategoryName(e.target.value)}
              className="h-11 rounded-xl border-2 font-bold flex-1" />
            <Button type="button" onClick={() => {
              if (newCategoryName.trim()) { setValue('category', newCategoryName.trim()); }
              setIsAddingCategory(false); setNewCategoryName('');
            }} className="h-11 w-11 rounded-xl shrink-0"><Check className="w-4 h-4" /></Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Controller name="category" control={control} render={({ field }) => (
              <Select onValueChange={field.onChange} value={field.value}>
                <SelectTrigger className="h-11 rounded-xl border-2 font-bold flex-1"><SelectValue /></SelectTrigger>
                <SelectContent className="rounded-xl border-2 shadow-xl">
                  {categories.map(c => <SelectItem key={c} value={c} className="font-bold text-xs">{c}</SelectItem>)}
                </SelectContent>
              </Select>
            )} />
            <Button type="button" variant="outline" onClick={() => setIsAddingCategory(true)}
              className="h-11 w-11 rounded-xl border-2 shrink-0"><PlusCircle className="w-4 h-4" /></Button>
          </div>
        )}
      </div>

      {/* Description */}
      <div className="space-y-1.5">
        <FieldLabel>Description</FieldLabel>
        <Textarea {...register('description')} placeholder="Describe this item for guests…"
          className="rounded-xl border-2 min-h-[80px] resize-none text-sm font-medium" />
      </div>

      {/* Image */}
      <div className="space-y-1.5">
        <FieldLabel>Image</FieldLabel>
        <Controller name="imageUrl" control={control}
          render={({ field }) => <ImageUpload onImageUploaded={field.onChange} initialImage={field.value} />} />
      </div>

      {/* Price + Visibility */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <FieldLabel>Guest price ($)</FieldLabel>
          <div className="relative">
            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input type="number" step="0.01" {...register('price')}
              className="h-12 pl-9 rounded-xl border-2 font-black text-lg" />
          </div>
          <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wide">Leave at 0.00 for complimentary</p>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 rounded-xl border-2 border-slate-200">
            <div>
              <p className="text-sm font-black uppercase tracking-tight text-slate-900">Visible to guests</p>
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">Shows in menu</p>
            </div>
            <Controller name="showInConcierge" control={control}
              render={({ field }) => (
                <Switch checked={field.value} onCheckedChange={field.onChange} className="data-[state=checked]:bg-primary" />
              )} />
          </div>
          <div className="flex items-center justify-between p-3 rounded-xl border-2 border-indigo-100 bg-indigo-50/50">
            <div>
              <p className="text-sm font-black uppercase tracking-tight text-indigo-700 flex items-center gap-1.5">
                <Lock className="w-3 h-3" /> Members only
              </p>
              <p className="text-[9px] font-bold text-indigo-400 uppercase tracking-wide">Gated perk</p>
            </div>
            <Controller name="isMembersOnly" control={control}
              render={({ field }) => (
                <Switch checked={field.value} onCheckedChange={field.onChange} className="data-[state=checked]:bg-indigo-600" />
              )} />
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── STEP 2: Stock & Recipe ───────────────────────────────────────────────────
const Step2 = ({ locations }: { locations: Location[] }) => {
  const { inventory } = useInventory();
  const { control, register, watch, setValue, formState: { errors } } = useFormContext<RefreshmentFormData>();
  const [isProductBrowserOpen, setIsProductBrowserOpen] = useState(false);

  const trackingMethod = watch('trackingMethod');
  const hasRecipe      = watch('hasRecipe');
  const formula        = watch('formula') || [];
  const purchaseCost   = watch('purchaseCost');

  // Auto-calculate cost from recipe
  const formulaCost = useMemo(() =>
    formula.reduce((sum, item) => sum + safeNumber(item.quantityUsed) * safeNumber(item.costPerUnit), 0),
    [formula]
  );

  useEffect(() => {
    if (hasRecipe && formula.length > 0) {
      setValue('purchaseCost', Number(formulaCost.toFixed(2)), { shouldDirty: true });
    }
  }, [formulaCost, hasRecipe, formula.length, setValue]);

  const handleAddIngredients = (products: InventoryItem[]) => {
    const newIngredients = products.map(p => {
      const unit = p.costingMethod === 'size' ? (p.unit || 'ml') : (p.useUnit || 'uses');
      let cpu = p.costPerUnit || 0;
      if (p.costingMethod === 'size' && p.size) cpu = cpu / p.size;
      else if (p.costingMethod === 'uses' && p.estimatedUses) cpu = cpu / p.estimatedUses;
      return { id: p.id, name: p.name, quantityUsed: 1, unit, costPerUnit: cpu };
    });
    setValue('formula', [...formula, ...newIngredients.filter(ni => !formula.find(f => f.id === ni.id))], { shouldDirty: true });
    setIsProductBrowserOpen(false);
  };

  return (
    <div className="space-y-6">
      <StepHeader icon={Package} title="Stock & Recipe" subtitle="How much you have, how it's measured, and what goes into it." step={2} />

      {/* ── STOCK — most important, top ── */}
      <div className="p-5 rounded-2xl border-2 border-primary/20 bg-primary/5 space-y-4">
        <p className="text-[9px] font-black uppercase tracking-widest text-primary/70">Current Stock</p>
        <div className="space-y-1.5">
          <FieldLabel required>How many units do you have right now?</FieldLabel>
          <Input type="number" min="0" {...register('currentStock')} placeholder="e.g. 12"
            className="h-14 rounded-xl border-2 font-black text-2xl text-center border-primary/30 focus:border-primary" />
          {errors.currentStock && <p className="text-[10px] font-bold text-red-500">{errors.currentStock.message}</p>}
          <p className="text-[9px] text-slate-400 font-bold">A "unit" is what you receive from your supplier — a bottle, bag, box, etc.</p>
        </div>
      </div>

      {/* ── HOW IS ONE UNIT MEASURED ── */}
      <div className="space-y-4">
        <div className="space-y-1.5">
          <FieldLabel>How is one unit measured?</FieldLabel>
          <p className="text-[10px] text-slate-400">This tells the system how to deduct stock when used at an event.</p>
          <Controller name="trackingMethod" control={control} render={({ field }) => (
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'volume',   label: 'By volume',   sub: 'e.g. 750ml bottle', icon: '🧪' },
                { value: 'servings', label: 'By servings', sub: 'e.g. 1 bottle = 8 glasses', icon: '🥂' },
              ].map(opt => (
                <button key={opt.value} type="button" onClick={() => field.onChange(opt.value)}
                  className={cn('flex flex-col items-start p-4 rounded-xl border-2 transition-all text-left',
                    field.value === opt.value ? 'border-primary bg-primary/5' : 'border-slate-200 bg-white hover:border-slate-300')}>
                  <span className="text-xl mb-2">{opt.icon}</span>
                  <p className="font-black text-sm text-slate-900">{opt.label}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">{opt.sub}</p>
                </button>
              ))}
            </div>
          )} />
        </div>

        {/* Volume details */}
        {trackingMethod === 'volume' && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <FieldLabel>Size per unit</FieldLabel>
              <Input type="number" {...register('containerSize')} placeholder="e.g. 750"
                className="h-11 rounded-xl border-2 font-bold text-center" />
            </div>
            <div className="space-y-1.5">
              <FieldLabel>Unit</FieldLabel>
              <Controller name="containerUnit" control={control} render={({ field }) => (
                <Select onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger className="h-11 rounded-xl border-2 font-bold"><SelectValue placeholder="ml" /></SelectTrigger>
                  <SelectContent className="rounded-xl border-2 shadow-xl">
                    <SelectItem value="ml" className="font-bold">ml</SelectItem>
                    <SelectItem value="oz" className="font-bold">oz</SelectItem>
                    <SelectItem value="g"  className="font-bold">g</SelectItem>
                    <SelectItem value="kg" className="font-bold">kg</SelectItem>
                    <SelectItem value="L"  className="font-bold">L</SelectItem>
                  </SelectContent>
                </Select>
              )} />
            </div>
          </div>
        )}

        {/* Servings details */}
        {trackingMethod === 'servings' && (
          <div className="space-y-1.5">
            <FieldLabel>How many servings per unit?</FieldLabel>
            <Input type="number" {...register('servingsPerUnit')} placeholder="e.g. 8"
              className="h-12 rounded-xl border-2 font-black text-xl text-center" />
            <p className="text-[9px] text-slate-400 font-bold">One "serving" = one use at an event (one glass, one scoop, etc.)</p>
          </div>
        )}
      </div>

      {/* ── COST PER UNIT ── */}
      <div className="space-y-1.5">
        <FieldLabel>What does one unit cost you?</FieldLabel>
        <div className="relative">
          <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input type="number" step="0.01" {...register('purchaseCost')}
            readOnly={hasRecipe && formula.length > 0}
            placeholder="0.00"
            className={cn('h-12 pl-9 rounded-xl border-2 font-black text-lg',
              hasRecipe && formula.length > 0 ? 'bg-slate-50 text-slate-400 cursor-not-allowed' : '')} />
        </div>
        {hasRecipe && formula.length > 0 && (
          <p className="text-[9px] text-primary font-bold">Auto-calculated from recipe below (${formulaCost.toFixed(2)})</p>
        )}
      </div>

      {/* ── VENDOR + DATE ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <FieldLabel>Supplier / Vendor</FieldLabel>
          <Input {...register('supplier')} placeholder="e.g. Whole Foods, Sysco"
            className="h-11 rounded-xl border-2 font-bold" />
        </div>
        <div className="space-y-1.5">
          <FieldLabel>Intake date</FieldLabel>
          <Controller name="purchaseDate" control={control} render={({ field }) => (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" type="button"
                  className="w-full h-11 rounded-xl border-2 font-bold justify-start px-3 text-sm">
                  <CalendarIcon className="mr-2 h-4 w-4 text-slate-400" />
                  {field.value ? format(field.value, 'MMM d, yyyy') : 'Pick a date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 rounded-2xl overflow-hidden shadow-xl border-2">
                <Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus />
              </PopoverContent>
            </Popover>
          )} />
        </div>
      </div>

      {/* ── STORAGE LOCATION ── */}
      {locations.length > 0 && (
        <div className="space-y-1.5">
          <FieldLabel>Storage location</FieldLabel>
          <Controller name="primaryLocationId" control={control} render={({ field }) => (
            <Select onValueChange={field.onChange} value={field.value}>
              <SelectTrigger className="h-11 rounded-xl border-2 font-bold"><SelectValue placeholder="Select location" /></SelectTrigger>
              <SelectContent className="rounded-xl border-2 shadow-xl">
                {locations.map(loc => <SelectItem key={loc.id} value={loc.id} className="font-bold">{loc.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )} />
        </div>
      )}

      {/* ── RECIPE SECTION (collapsible) ── */}
      <div className={cn('rounded-2xl border-2 overflow-hidden transition-colors',
        hasRecipe ? 'border-primary/30' : 'border-slate-200')}>
        {/* Toggle */}
        <button type="button"
          onClick={() => setValue('hasRecipe', !hasRecipe, { shouldDirty: true })}
          className="w-full p-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
          <div className="flex items-center gap-3">
            <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center transition-colors',
              hasRecipe ? 'bg-primary/10 text-primary' : 'bg-slate-100 text-slate-400')}>
              <FlaskConical className="w-4 h-4" />
            </div>
            <div className="text-left">
              <p className="font-black text-sm text-slate-900">This item has a recipe</p>
              <p className="text-[10px] text-slate-400">e.g. a cocktail made from multiple ingredients</p>
            </div>
          </div>
          <div className={cn('w-5 h-5 rounded border-2 flex items-center justify-center transition-all shrink-0',
            hasRecipe ? 'border-primary bg-primary' : 'border-slate-300')}>
            {hasRecipe && <Check className="w-3 h-3 text-white" />}
          </div>
        </button>

        {/* Recipe content */}
        {hasRecipe && (
          <div className="border-t border-slate-100 p-4 space-y-4 bg-slate-50/50">
            <div className="flex items-center justify-between">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Ingredients</p>
              <Button type="button" variant="outline" size="sm" onClick={() => setIsProductBrowserOpen(true)}
                className="h-7 px-3 text-[9px] font-black uppercase tracking-widest border rounded-lg">
                <PlusCircle className="w-3 h-3 mr-1.5" /> Add ingredient
              </Button>
            </div>

            {formula.length === 0 ? (
              <div className="p-8 text-center border-2 border-dashed border-slate-200 rounded-xl">
                <Activity className="w-7 h-7 mx-auto mb-2 text-slate-300" />
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">No ingredients yet</p>
                <p className="text-[10px] text-slate-400 mt-1">Click "Add ingredient" to build the recipe</p>
              </div>
            ) : (
              <div className="space-y-2">
                {formula.map((item, index) => (
                  <div key={item.id} className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 bg-white">
                    <div className="flex-1 min-w-0">
                      <p className="font-black text-sm text-slate-900 truncate">{item.name}</p>
                      <p className="text-[9px] text-slate-400 font-bold uppercase">
                        ${(item.costPerUnit || 0).toFixed(4)} / {item.unit}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Input type="number" value={item.quantityUsed} step="0.1"
                        onChange={e => {
                          const next = [...formula];
                          next[index] = { ...next[index], quantityUsed: parseFloat(e.target.value) || 0 };
                          setValue('formula', next, { shouldDirty: true });
                        }}
                        className="w-16 h-8 rounded-lg border-2 text-center font-black text-sm" />
                      <span className="text-[9px] font-bold text-slate-400 uppercase w-8 truncate">{item.unit}</span>
                      <button type="button" onClick={() => setValue('formula', formula.filter(f => f.id !== item.id))}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-slate-300 hover:text-red-400 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
                {/* Cost summary */}
                <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-primary/5 border border-primary/20">
                  <p className="text-[10px] font-black uppercase tracking-widest text-primary/70">Total recipe cost</p>
                  <p className="font-black text-primary">${formulaCost.toFixed(2)}</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <BrowseProductsDialog
        open={isProductBrowserOpen} onOpenChange={setIsProductBrowserOpen}
        onSelect={handleAddIngredients}
        allProducts={inventory.filter(p => p.type === 'professional' || p.type === 'overhead')}
        initialSelected={[]}
      />
    </div>
  );
};

// ─── MAIN DIALOG ──────────────────────────────────────────────────────────────
export const AddRefreshmentDialog = ({
  open, onOpenChange, onRefreshmentAdded, locations,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRefreshmentAdded: (item: InventoryItem) => void;
  locations: Location[];
}) => {
  const [step, setStep] = useState(1);
  const isMobile = useIsMobile();

  const methods = useForm<RefreshmentFormData>({
    resolver: zodResolver(refreshmentSchema),
    defaultValues: {
      trackingMethod: 'servings',
      currentStock: 1,
      category: 'Artisanal Beverages',
      purchaseDate: new Date(),
      showInConcierge: true,
      isMembersOnly: false,
      price: 0,
      purchaseCost: 0,
      hasRecipe: false,
      formula: [],
    },
  });

  useEffect(() => {
    if (open) {
      methods.reset({
        trackingMethod: 'servings', currentStock: 1, category: 'Artisanal Beverages',
        purchaseDate: new Date(), showInConcierge: true, isMembersOnly: false,
        price: 0, purchaseCost: 0, hasRecipe: false, formula: [],
      });
      setStep(1);
    }
  }, [open, methods]);

  const { handleSubmit, trigger } = methods;

  const onSubmit = (data: RefreshmentFormData) => {
    const unitPrice = data.purchaseCost;
    onRefreshmentAdded({
      id:                `refr-${nanoid(8)}`,
      name:              data.name,
      description:       data.description,
      type:              'refreshment',
      category:          data.category,
      totalStock:        data.currentStock,
      costPerUnit:       unitPrice,
      supplier:          data.supplier || '',
      primaryLocationId: data.primaryLocationId,
      // Map new field names back to existing InventoryItem shape
      costingMethod:     data.trackingMethod === 'volume' ? 'size' : 'uses',
      size:              data.containerSize,
      unit:              data.containerUnit as any,
      estimatedUses:     data.servingsPerUnit,
      showInConcierge:   data.showInConcierge,
      isMembersOnly:     data.isMembersOnly,
      price:             data.price,
      imageUrl:          data.imageUrl,
      formula:           data.formula,
      batches: [{
        id:           `batch-${nanoid(6)}`,
        stock:        data.currentStock,
        costPerUnit:  unitPrice,
        receivedDate: data.purchaseDate.toISOString(),
      }],
    });
    onOpenChange(false);
  };

  const handleNext = async (e: React.MouseEvent) => {
    e.preventDefault();
    const valid = await trigger(['name', 'category']);
    if (valid) setStep(2);
  };

  const handleBack = (e: React.MouseEvent) => { e.preventDefault(); setStep(1); };

  const formBody = (
    <FormProvider {...methods}>
      <form id="add-refreshment-form" onSubmit={handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">

        {/* Header */}
        <div className={cn('flex-shrink-0 border-b bg-white', isMobile ? 'p-5' : 'p-6 pb-5')}>
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Add to Refreshment Library</span>
          </div>
          <h2 className="text-2xl font-black uppercase tracking-tighter text-slate-900">
            {step === 1 ? 'What is it?' : 'Stock & Recipe'}
          </h2>
          <div className="mt-4">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Step {step} of 2</span>
            </div>
            <Progress value={step === 1 ? 50 : 100} className="h-1.5 rounded-full bg-slate-100" />
          </div>
        </div>

        {/* Content */}
        <ScrollArea className="flex-1">
          <div className={cn('pb-24', isMobile ? 'p-5' : 'p-6')}>
            {step === 1 && <Step1 />}
            {step === 2 && <Step2 locations={locations} />}
          </div>
        </ScrollArea>

        {/* Footer */}
        <div className={cn('flex-shrink-0 border-t bg-white', isMobile ? 'p-4' : 'p-5')}>
          <div className="flex gap-3">
            {step > 1 && (
              <Button type="button" variant="outline" onClick={handleBack}
                className="h-12 px-5 rounded-xl font-black uppercase text-[10px] tracking-widest border-2">
                Back
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}
              className="h-12 px-5 rounded-xl font-black uppercase text-[10px] tracking-widest border-2">
              Cancel
            </Button>
            {step < 2 ? (
              <Button type="button" onClick={handleNext}
                className="flex-1 h-12 rounded-xl font-black uppercase text-[10px] tracking-widest gap-2 shadow-lg shadow-primary/20">
                Continue <ArrowRight className="w-4 h-4" />
              </Button>
            ) : (
              <Button type="submit" form="add-refreshment-form"
                className="flex-1 h-12 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-primary/20">
                Add to Library →
              </Button>
            )}
          </div>
        </div>
      </form>
    </FormProvider>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="p-0 border-none bg-white flex flex-col h-[92dvh] rounded-t-[2rem] overflow-hidden">
          {formBody}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 border-none bg-white flex flex-col shadow-2xl overflow-hidden sm:max-w-2xl max-h-[90dvh] rounded-[2rem]">
        {formBody}
      </DialogContent>
    </Dialog>
  );
};