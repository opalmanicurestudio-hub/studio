'use client';

/**
 * ServiceFormSheet — unified add/edit form for services and add-ons.
 *
 * KEY ARCHITECTURAL DECISIONS:
 * 1. No nested dialogs. All sub-selections (products, add-ons, resources,
 *    consent forms) happen via inline expandable search panels rendered
 *    inside the same Sheet. Zero Dialog-inside-Dialog.
 * 2. No <form> element. react-hook-form is used for state only.
 *    Save calls handleSubmit(onSubmit) via onClick. No accidental submission.
 * 3. Single scrollable view — every field is always reachable.
 *    Nothing is hidden behind a step wizard.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { ImageUpload } from '@/components/shared/ImageUpload';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion, AnimatePresence } from 'framer-motion';
import { cn, safeNumber } from '@/lib/utils';
import {
  Search, ChevronDown, ChevronUp, Check, Plus, Trash2, DollarSign,
  Package, PlusCircle, Hammer, MapPin, ListChecks, Activity, Target,
  FileText, X, Loader, Zap,
} from 'lucide-react';
import { type Service, type Resource, type ConsentForm, type PricingTier, type Staff, type InventoryItem } from '@/lib/data';
import { useInventory } from '@/context/InventoryContext';
import { useTenant } from '@/context/TenantContext';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { collection } from 'firebase/firestore';
import { nanoid } from 'nanoid';

const schema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'Name is required'),
  type: z.enum(['service', 'addon']),
  isAddon: z.boolean().optional(),
  category: z.string().min(1, 'Category is required'),
  duration: z.coerce.number().min(1, 'Duration required'),
  padBefore: z.coerce.number().optional(),
  padAfter: z.coerce.number().optional(),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
  isPrivate: z.boolean().optional(),
  products: z.array(z.any()).optional(),
  requiredResourceIds: z.array(z.string()).optional(),
  compatibleAddOnIds: z.array(z.string()).optional(),
  depositType: z.enum(['none', 'deposit', 'full', 'breakeven']),
  depositSubType: z.enum(['flat', 'percentage']).optional(),
  depositAmount: z.coerce.number().optional(),
  price: z.coerce.number().optional(),
  serviceTiers: z.array(z.object({
    tierId: z.string(),
    price: z.coerce.number().min(0),
    durationMinutes: z.coerce.number().min(1),
  })).optional(),
  confirmationMessage: z.string().optional(),
  requiredFormIds: z.array(z.string()).optional(),
  // v2 — NEW: document/file requirements configured once at the service
  // level, mirroring requiredFormIds above. Previously the only place
  // "Photo ID" or similar could be requested was ad-hoc, per-booking, in
  // AppointmentDetailsSheet's request panel or QuickBookForm's single
  // hardcoded "inspiration photos" toggle — nothing tied a requirement to
  // WHICH service was booked, so nobody (least of all an automated
  // booking agent with no human judgment to fall back on) had a reliable
  // way to know a given treatment always needs a photo ID without
  // remembering it case by case.
  requiredFileRequirements: z.array(z.object({
    id: z.string(),
    label: z.string().min(1),
    minCount: z.coerce.number().min(1).optional(),
    maxCount: z.coerce.number().optional(),
    persistToProfile: z.boolean().optional(),
  })).optional(),
  cancellationWindowHours: z.coerce.number().optional(),
  customCancellationFee: z.coerce.number().optional(),
}).superRefine((data, ctx) => {
  const hasTiers = data.serviceTiers && data.serviceTiers.length > 0;
  if (!hasTiers && (data.price === undefined || data.price < 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Price required', path: ['price'] });
  }
});

type FormData = z.infer<typeof schema>;

// FIX: The generic constraint only required `{ id: string; name: string }`,
// but ConsentForm documents use `title`, not `name`. Every consent form
// therefore had `i.name === undefined`, and `i.name.toLowerCase()` threw
// the instant this panel rendered — which happens immediately when the
// sheet opens, since "Required Consent Forms" passes consentForms into
// this exact component. Same risk applies to any item missing `name`
// for any reason (malformed Firestore doc), so the fallback covers that
// case generally too.
function InlineSearchPanel<T extends { id: string; name?: string }>({
  label, icon: Icon, items, selectedIds, onToggle, renderItem, emptyText, searchPlaceholder,
}: {
  label: string;
  icon: any;
  items: T[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  renderItem?: (item: T, selected: boolean) => React.ReactNode;
  emptyText: string;
  searchPlaceholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  const filtered = useMemo(() =>
    (items || []).filter(i => {
      const itemLabel = i.name || (i as any).title || '';
      return itemLabel.toLowerCase().includes(q.toLowerCase());
    }),
    [items, q]);

  const selectedCount = selectedIds.length;

  return (
    <div className="rounded-2xl border-2 border-slate-100 bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-primary/40 shrink-0" />
          <span className="font-black uppercase text-[11px] tracking-widest text-slate-700">{label}</span>
          {selectedCount > 0 && (
            <Badge className="bg-primary text-white border-none font-black text-[8px] h-4 px-1.5">{selectedCount}</Badge>
          )}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden border-t border-slate-100"
          >
            <div className="p-3 space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input
                  type="text"
                  value={q}
                  onChange={e => setQ(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="w-full h-9 pl-8 pr-3 rounded-xl border-2 border-slate-100 bg-slate-50 text-[11px] font-bold uppercase tracking-tight outline-none focus:border-primary/30"
                />
              </div>
              <div className="max-h-52 overflow-y-auto space-y-1">
                {filtered.length === 0 && (
                  <p className="text-center py-6 text-[10px] font-black uppercase text-slate-400">{emptyText}</p>
                )}
                {filtered.map(item => {
                  const selected = selectedIds.includes(item.id);
                  const displayLabel = item.name || (item as any).title || 'Untitled';
                  return (
                    <div
                      key={item.id}
                      onClick={() => onToggle(item.id)}
                      className={cn(
                        'flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-all',
                        selected ? 'bg-primary/5 border border-primary/20' : 'hover:bg-slate-50 border border-transparent'
                      )}
                    >
                      <div className={cn(
                        'w-5 h-5 rounded-lg border-2 flex items-center justify-center shrink-0 transition-all',
                        selected ? 'bg-primary border-primary' : 'border-slate-300'
                      )}>
                        {selected && <Check className="w-3 h-3 text-white" />}
                      </div>
                      {renderItem
                        ? renderItem(item, selected)
                        : <span className="font-bold uppercase text-[10px] text-slate-700 flex-1">{displayLabel}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[9px] font-black uppercase tracking-[0.2em] text-primary/60 px-1 mb-3">{children}</p>
);

const RecoveryMatrix = ({ pricingTiers, values, tmhr, taxBurden, staff }: {
  pricingTiers: PricingTier[]; values: any; tmhr: number; taxBurden: number; staff: Staff[];
}) => {
  const { inventory } = useInventory();
  const materialCost = useMemo(() => (values.products || []).reduce((acc: number, p: any) => {
    const prod = inventory.find(i => i.id === p.id);
    let cpu = 0;
    if (prod) {
      if (prod.costingMethod === 'size' && prod.size) cpu = (prod.costPerUnit || 0) / prod.size;
      else if (prod.costingMethod === 'uses' && prod.estimatedUses) cpu = (prod.costPerUnit || 0) / prod.estimatedUses;
      else cpu = prod.costPerUnit || 0;
    }
    return acc + (cpu * (p.quantityUsed || 1));
  }, 0), [values.products, inventory]);

  // FIX: spread into a new array before sorting — pricingTiers comes
  // straight from a useCollection Firestore hook, and .sort() mutates
  // in place. Guard `rank` in case any tier document is missing it.
  const rows = useMemo(() => [...pricingTiers].sort((a, b) => (a.rank || 0) - (b.rank || 0)).map(tier => {
    const tc = (values.serviceTiers || []).find((t: any) => t.tierId === tier.id);
    const price = tc ? tc.price : (values.price || 0);
    const dur = tc ? tc.durationMinutes : (values.duration || 60);
    const timeVal = (dur / 60) * tmhr;
    const rs = staff.filter(s => s.pricingTierId === tier.id);
    const labor = rs.reduce((acc, s) => {
      let l = 0;
      if (s.payStructure === 'commission') l = price * (s.commissionRate / 100);
      else if (s.payStructure === 'hourly' && s.hourlyRate) l = (dur / 60) * s.hourlyRate;
      return acc + l * (1 + taxBurden / 100);
    }, 0) / (rs.length || 1);
    return { id: tier.id, name: tier.name, target: timeVal + materialCost + labor };
  }), [pricingTiers, values, tmhr, materialCost, staff, taxBurden]);

  if (rows.length === 0) return null;
  return (
    <div className="rounded-2xl border-2 border-primary/10 bg-primary/[0.02] p-4 space-y-2">
      <p className="text-[9px] font-black uppercase tracking-widest text-primary/60 flex items-center gap-1.5"><Target className="w-3 h-3" />Recovery Targets</p>
      {rows.map(r => (
        <div key={r.id} className="flex justify-between items-center">
          <span className="text-[10px] font-bold uppercase text-slate-600">{r.name}</span>
          <span className="font-black font-mono text-sm text-primary">${r.target.toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
};

interface ServiceFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'add' | 'edit';
  service?: Service;
  initialType?: 'service' | 'addon';
  categories: string[];
  onNewCategory: (cat: string) => void;
  resources: Resource[];
  services: Service[];
  onSave: (service: any) => void;
}

export const ServiceFormSheet: React.FC<ServiceFormSheetProps> = ({
  open, onOpenChange, mode, service, initialType = 'service',
  categories, onNewCategory, resources, services, onSave,
}) => {
  const { inventory, staff } = useInventory();
  const { selectedTenant } = useTenant();
  const { firestore } = useFirebase();
  const tmhr = selectedTenant?.tmhr || 50;
  const taxBurden = selectedTenant?.employerTaxBurdenPct || 10;

  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [saving, setSaving] = useState(false);
  const [newFileReqLabel, setNewFileReqLabel] = useState('');
  const [newFileReqPersist, setNewFileReqPersist] = useState(false);

  const { data: consentForms }   = useCollection<ConsentForm>(useMemoFirebase(() => !firestore || !selectedTenant ? null : collection(firestore, `tenants/${selectedTenant.id}/consentForms`), [firestore, selectedTenant]));
  const { data: pricingTiers }   = useCollection<PricingTier>(useMemoFirebase(() => !firestore || !selectedTenant ? null : collection(firestore, `tenants/${selectedTenant.id}/pricingTiers`), [firestore, selectedTenant]));

  const { control, register, watch, setValue, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      type: initialType, isAddon: initialType === 'addon',
      depositType: 'none', products: [], requiredResourceIds: [],
      compatibleAddOnIds: [], serviceTiers: [], requiredFormIds: [],
      requiredFileRequirements: [],
      price: 0, padBefore: 0, padAfter: 0,
    },
  });

  const values     = watch();
  const isAddon    = watch('isAddon');
  const depositType = watch('depositType');
  const serviceId  = service?.id;

  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && service) {
      reset({
        id: service.id, name: service.name, type: service.type,
        isAddon: service.type === 'addon', isPrivate: service.isPrivate,
        category: service.category, duration: service.duration,
        padBefore: service.padBefore || 0, padAfter: service.padAfter || 0,
        description: service.description || '', imageUrl: service.imageUrl || '',
        price: service.price, serviceTiers: service.serviceTiers || [],
        products: service.products || [], requiredResourceIds: service.requiredResourceIds || [],
        compatibleAddOnIds: service.compatibleAddOnIds || [],
        depositType: service.depositType || 'none', depositSubType: service.depositSubType,
        depositAmount: service.depositAmount, confirmationMessage: service.confirmationMessage || '',
        requiredFormIds: service.requiredFormIds || [], capacity: service.capacity,
        requiredFileRequirements: (service as any).requiredFileRequirements || [],
        cancellationWindowHours: service.cancellationWindowHours,
        customCancellationFee: service.customCancellationFee,
      });
    } else {
      reset({
        type: initialType, isAddon: initialType === 'addon', depositType: 'none',
        products: [], requiredResourceIds: [], compatibleAddOnIds: [],
        serviceTiers: [], requiredFormIds: [], requiredFileRequirements: [],
        price: 0, padBefore: 0, padAfter: 0,
      });
    }
  }, [open, serviceId, mode]);

  useEffect(() => {
    if (depositType === 'breakeven') {
      const total = (values.duration || 0) + (values.padBefore || 0) + (values.padAfter || 0);
      const mat = (values.products || []).reduce((acc: number, p: any) => {
        const prod = inventory.find(i => i.id === p.id);
        let cpu = 0;
        if (prod) {
          if (prod.costingMethod === 'size' && prod.size) cpu = (prod.costPerUnit || 0) / prod.size;
          else if (prod.costingMethod === 'uses' && prod.estimatedUses) cpu = (prod.costPerUnit || 0) / prod.estimatedUses;
          else cpu = prod.costPerUnit || 0;
        }
        return acc + cpu * (p.quantityUsed || 1);
      }, 0);
      setValue('depositAmount', parseFloat(((total / 60) * tmhr + mat).toFixed(2)));
      setValue('depositSubType', 'flat');
    }
  }, [depositType]);

  const breakEven = useMemo(() => {
    const total = (values.duration || 0) + (values.padBefore || 0) + (values.padAfter || 0);
    const mat = (values.products || []).reduce((acc: number, p: any) => {
      const prod = inventory.find(i => i.id === p.id);
      let cpu = 0;
      if (prod) {
        if (prod.costingMethod === 'size' && prod.size) cpu = (prod.costPerUnit || 0) / prod.size;
        else if (prod.costingMethod === 'uses' && prod.estimatedUses) cpu = (prod.costPerUnit || 0) / prod.estimatedUses;
        else cpu = prod.costPerUnit || 0;
      }
      return acc + cpu * (p.quantityUsed || 1);
    }, 0);
    return (total / 60) * tmhr + mat;
  }, [values.duration, values.padBefore, values.padAfter, values.products, tmhr, inventory]);

  const selectedProducts    = watch('products') || [];
  const selectedResourceIds = watch('requiredResourceIds') || [];
  const selectedAddOnIds    = watch('compatibleAddOnIds') || [];
  const selectedFormIds     = watch('requiredFormIds') || [];
  const fileRequirements    = watch('requiredFileRequirements') || [];
  const serviceTiers        = watch('serviceTiers') || [];

  const toggleProduct = useCallback((id: string) => {
    const prod = inventory.find(i => i.id === id);
    if (!prod) return;
    const exists = selectedProducts.find((p: any) => p.id === id);
    if (exists) {
      setValue('products', selectedProducts.filter((p: any) => p.id !== id), { shouldDirty: true });
    } else {
      let cpu = prod.costPerUnit || 0;
      if (prod.costingMethod === 'size' && prod.size) cpu = (prod.costPerUnit || 0) / prod.size;
      else if (prod.costingMethod === 'uses' && prod.estimatedUses) cpu = (prod.costPerUnit || 0) / prod.estimatedUses;
      setValue('products', [...selectedProducts, {
        id: prod.id, name: prod.name, costPerUnit: cpu, unit: prod.unit,
        useUnit: prod.useUnit, costingMethod: prod.costingMethod,
        size: prod.size, estimatedUses: prod.estimatedUses, quantityUsed: 1,
      }], { shouldDirty: true });
    }
  }, [inventory, selectedProducts, setValue]);

  const toggleResource = useCallback((id: string) => {
    const next = selectedResourceIds.includes(id)
      ? selectedResourceIds.filter((i: string) => i !== id)
      : [...selectedResourceIds, id];
    setValue('requiredResourceIds', next, { shouldDirty: true });
  }, [selectedResourceIds, setValue]);

  const toggleAddOn = useCallback((id: string) => {
    const next = selectedAddOnIds.includes(id)
      ? selectedAddOnIds.filter((i: string) => i !== id)
      : [...selectedAddOnIds, id];
    setValue('compatibleAddOnIds', next, { shouldDirty: true });
  }, [selectedAddOnIds, setValue]);

  const toggleForm = useCallback((id: string) => {
    const next = selectedFormIds.includes(id)
      ? selectedFormIds.filter((i: string) => i !== id)
      : [...selectedFormIds, id];
    setValue('requiredFormIds', next, { shouldDirty: true });
  }, [selectedFormIds, setValue]);

  // v2 — file requirements are custom, ad-hoc entries (not picked from an
  // existing list like consent forms are), so these build/edit the array
  // directly rather than toggling membership in a fixed source list.
  const addFileRequirement = useCallback((label: string, persistToProfile: boolean) => {
    if (!label.trim()) return;
    setValue('requiredFileRequirements', [
      ...fileRequirements,
      { id: `filereq_${nanoid()}`, label: label.trim(), minCount: 1, maxCount: 5, persistToProfile },
    ], { shouldDirty: true });
  }, [fileRequirements, setValue]);

  const removeFileRequirement = useCallback((id: string) => {
    setValue('requiredFileRequirements', fileRequirements.filter((f: any) => f.id !== id), { shouldDirty: true });
  }, [fileRequirements, setValue]);

  const updateFileRequirement = useCallback((id: string, patch: Record<string, any>) => {
    setValue('requiredFileRequirements', fileRequirements.map((f: any) => f.id === id ? { ...f, ...patch } : f), { shouldDirty: true });
  }, [fileRequirements, setValue]);

  const toggleTier = (tierId: string, checked: boolean) => {
    if (checked) {
      if (!serviceTiers.find((t: any) => t.tierId === tierId)) {
        setValue('serviceTiers', [...serviceTiers, { tierId, price: 0, durationMinutes: values.duration || 60 }], { shouldDirty: true });
      }
    } else {
      setValue('serviceTiers', serviceTiers.filter((t: any) => t.tierId !== tierId), { shouldDirty: true });
    }
  };

  const updateTier = (tierId: string, field: 'price' | 'durationMinutes', val: number) => {
    setValue('serviceTiers', serviceTiers.map((t: any) => t.tierId === tierId ? { ...t, [field]: val } : t), { shouldDirty: true });
  };

  const handleNewCategory = () => {
    if (newCategoryName.trim() && !(categories || []).includes(newCategoryName.trim())) {
      onNewCategory(newCategoryName.trim());
      setValue('category', newCategoryName.trim(), { shouldValidate: true });
      setNewCategoryName('');
      setIsAddingCategory(false);
    }
  };

  const onSubmit = (data: FormData) => {
    setSaving(true);
    let finalPrice = data.price || 0;
    if (pricingTiers?.length && data.serviceTiers?.length) {
      const senior = pricingTiers.find(t => (t.name || '').toLowerCase() === 'senior');
      finalPrice = data.serviceTiers.find((t: any) => t.tierId === senior?.id)?.price || data.serviceTiers[0].price;
    }
    const result = {
      ...(mode === 'edit' ? service : {}),
      ...data,
      id: mode === 'edit' ? service!.id : `svc-${nanoid()}`,
      type: data.isAddon ? 'addon' : 'service',
      price: finalPrice,
      cost: breakEven,
      profit: finalPrice - breakEven,
      margin: finalPrice > 0 ? ((finalPrice - breakEven) / finalPrice) * 100 : 0,
    };
    onSave(result);
    setSaving(false);
    onOpenChange(false);
  };

  const profProducts = useMemo(() => (inventory || []).filter(i => i.type === 'professional'), [inventory]);
  const addOnServices = useMemo(() => (services || []).filter(s => s.type === 'addon' && s.id !== service?.id), [services, service]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl p-0 border-none bg-background flex flex-col overflow-hidden"
      >
        <SheetHeader className="px-6 pt-6 pb-4 border-b bg-muted/5 shrink-0">
          <div className="flex items-center gap-2 mb-1">
            <Zap className="w-4 h-4 text-primary" />
            <span className="text-[9px] font-black uppercase tracking-[0.25em] text-primary/50">
              {mode === 'add' ? 'New Service' : 'Edit Service'}
            </span>
          </div>
          <SheetTitle className="text-2xl font-black uppercase tracking-tighter text-slate-900 leading-none">
            {mode === 'add' ? 'Register Treatment' : 'Modify Record'}
          </SheetTitle>
          <SheetDescription className="text-[9px] font-bold uppercase tracking-widest opacity-50 mt-0.5">
            All fields are live — changes take effect on save
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="px-6 py-6 space-y-8 pb-32">

            <section className="space-y-4">
              <SectionLabel>Identity</SectionLabel>

              <div className="flex items-center justify-between p-4 rounded-2xl border-2 border-slate-100 bg-white">
                <div>
                  <p className="font-black uppercase text-sm tracking-tight">Add-on Enhancement</p>
                  <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">Appendable to primary treatments</p>
                </div>
                <Controller name="isAddon" control={control} render={({ field }) => (
                  <Switch checked={!!field.value} onCheckedChange={checked => { field.onChange(checked); setValue('type', checked ? 'addon' : 'service'); }} />
                )} />
              </div>

              <div className="space-y-1.5">
                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Treatment Name</Label>
                <Input {...register('name')} placeholder="e.g., SIGNATURE BLOWOUT" className="h-14 rounded-2xl border-2 font-black uppercase text-lg tracking-tight" />
                {errors.name && <p className="text-[10px] font-black text-destructive">{errors.name.message}</p>}
              </div>

              <div className="space-y-1.5">
                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Category</Label>
                {isAddingCategory ? (
                  <div className="flex gap-2">
                    <Input
                      placeholder="NEW CATEGORY NAME"
                      value={newCategoryName}
                      onChange={e => setNewCategoryName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleNewCategory()}
                      className="h-12 rounded-xl border-2 font-black uppercase text-xs flex-1"
                    />
                    <Button type="button" onClick={handleNewCategory} className="h-12 px-4 rounded-xl"><Check className="w-4 h-4" /></Button>
                    <Button type="button" variant="ghost" onClick={() => setIsAddingCategory(false)} className="h-12 px-4 rounded-xl"><X className="w-4 h-4" /></Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Controller name="category" control={control} render={({ field }) => (
                      <Select onValueChange={field.onChange} value={field.value}>
                        <SelectTrigger className="h-12 rounded-xl border-2 font-black uppercase text-[10px] flex-1"><SelectValue placeholder="Select category" /></SelectTrigger>
                        <SelectContent className="rounded-xl border-2 shadow-2xl">
                          {(categories || []).map(c => <SelectItem key={c} value={c} className="font-bold uppercase text-[10px]">{c}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )} />
                    <Button type="button" variant="outline" onClick={() => setIsAddingCategory(true)} className="h-12 w-12 rounded-xl border-2 shrink-0"><Plus className="w-4 h-4" /></Button>
                  </div>
                )}
                {errors.category && <p className="text-[10px] font-black text-destructive">{errors.category.message}</p>}
              </div>

              <div className="grid grid-cols-3 gap-3">
                {[
                  { key: 'duration',  label: 'Duration (min)', placeholder: '60' },
                  { key: 'padBefore', label: 'Pre-pad (min)',   placeholder: '0'  },
                  { key: 'padAfter',  label: 'Post-pad (min)',  placeholder: '15' },
                ].map(({ key, label, placeholder }) => (
                  <div key={key} className="space-y-1.5 text-center">
                    <Label className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">{label}</Label>
                    <Input
                      type="number"
                      placeholder={placeholder}
                      {...register(key as any)}
                      className="h-12 rounded-xl border-2 font-black text-center text-lg"
                    />
                  </div>
                ))}
              </div>
              {errors.duration && <p className="text-[10px] font-black text-destructive text-center">{errors.duration.message}</p>}

              <div className="space-y-1.5">
                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Description</Label>
                <Textarea {...register('description')} placeholder="Describe the service..." className="rounded-2xl border-2 min-h-[80px]" />
              </div>

              <div className="space-y-1.5">
                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Menu Visual</Label>
                <Controller name="imageUrl" control={control} render={({ field }) => (
                  <ImageUpload onImageUploaded={field.onChange} initialImage={field.value} />
                )} />
              </div>
            </section>

            <Separator />

            <section className="space-y-3">
              <SectionLabel>Product Formula</SectionLabel>
              <InlineSearchPanel
                label="Products"
                icon={Package}
                items={profProducts}
                selectedIds={selectedProducts.map((p: any) => p.id)}
                onToggle={toggleProduct}
                searchPlaceholder="Search inventory..."
                emptyText="No professional products found"
                renderItem={(item, selected) => (
                  <div className="flex-1 flex items-center justify-between gap-2">
                    <span className="font-bold uppercase text-[10px] text-slate-700 truncate">{item.name || 'Untitled'}</span>
                    <span className="text-[9px] font-black text-primary/50 shrink-0">
                      {(item as any).costingMethod === 'uses' ? (item as any).useUnit || 'uses' : (item as any).unit || 'unit'}
                    </span>
                  </div>
                )}
              />
              {selectedProducts.length > 0 && (
                <div className="space-y-2 pt-1">
                  <p className="text-[9px] font-black uppercase text-muted-foreground opacity-50 px-1">Quantities</p>
                  {selectedProducts.map((product: any, index: number) => {
                    const inv = inventory.find(i => i.id === product.id);
                    const unit = inv?.costingMethod === 'uses' ? (inv.useUnit || 'uses') : (inv?.unit || 'ml');
                    return (
                      <div key={product.id} className="flex items-center gap-3 p-3 rounded-xl border-2 border-slate-100 bg-white">
                        <span className="font-black uppercase text-[10px] text-slate-700 flex-1 truncate">{product.name || 'Untitled'}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <Input
                            type="number"
                            value={product.quantityUsed || ''}
                            onChange={e => {
                              const next = [...selectedProducts];
                              next[index] = { ...product, quantityUsed: parseFloat(e.target.value) || 0 };
                              setValue('products', next, { shouldDirty: true });
                            }}
                            className="w-16 h-8 rounded-lg border-2 text-center font-black font-mono text-xs"
                            step="0.1"
                          />
                          <span className="text-[9px] font-black uppercase text-muted-foreground w-8 opacity-60">{unit}</span>
                          <button
                            type="button"
                            onClick={() => setValue('products', selectedProducts.filter((p: any) => p.id !== product.id), { shouldDirty: true })}
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-destructive hover:bg-destructive/10 transition-colors"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {!isAddon && (
              <>
                <Separator />
                <section className="space-y-3">
                  <SectionLabel>Compatible Add-ons</SectionLabel>
                  <InlineSearchPanel
                    label="Add-ons"
                    icon={PlusCircle}
                    items={addOnServices}
                    selectedIds={selectedAddOnIds}
                    onToggle={toggleAddOn}
                    searchPlaceholder="Search add-ons..."
                    emptyText="No add-ons found — create addon-type services first"
                    renderItem={(item, selected) => (
                      <div className="flex-1 flex items-center justify-between gap-2">
                        <span className="font-bold uppercase text-[10px] text-slate-700 truncate">{item.name || 'Untitled'}</span>
                        <span className="text-[9px] font-black text-primary/50 shrink-0">{(item as any).duration}m · ${((item as any).price || 0).toFixed(0)}</span>
                      </div>
                    )}
                  />
                </section>
              </>
            )}

            <Separator />
            <section className="space-y-3">
              <SectionLabel>Rooms & Equipment</SectionLabel>
              <InlineSearchPanel
                label="Resources"
                icon={Hammer}
                items={resources || []}
                selectedIds={selectedResourceIds}
                onToggle={toggleResource}
                searchPlaceholder="Search resources..."
                emptyText="No resources configured"
              />
            </section>

            <Separator />

            <section className="space-y-4">
              <SectionLabel>Pricing</SectionLabel>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between px-1">
                  <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Standard Price</Label>
                  <span className="text-[9px] font-black text-destructive uppercase">Breakeven: ${breakEven.toFixed(2)}</span>
                </div>
                <div className="relative">
                  <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-primary opacity-40" />
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    {...register('price')}
                    className="h-16 pl-12 rounded-2xl border-2 font-black text-3xl tracking-tighter text-primary"
                  />
                </div>
                {errors.price && <p className="text-[10px] font-black text-destructive">{errors.price.message}</p>}
              </div>

              <RecoveryMatrix
                pricingTiers={pricingTiers || []}
                values={values}
                tmhr={tmhr}
                taxBurden={taxBurden}
                staff={staff}
              />

              {(pricingTiers || []).length > 0 && (
                <div className="space-y-3">
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground px-1">Skill Tier Overrides</p>
                  <div className="space-y-2">
                    {[...(pricingTiers || [])].sort((a, b) => (a.rank || 0) - (b.rank || 0)).map(tier => {
                      const tierData = serviceTiers.find((t: any) => t.tierId === tier.id);
                      const enabled  = !!tierData;
                      return (
                        <div key={tier.id} className={cn('rounded-2xl border-2 overflow-hidden transition-all', enabled ? 'border-primary/30 bg-primary/[0.02]' : 'border-slate-100 opacity-60')}>
                          <div className="flex items-center justify-between px-4 py-3">
                            <span className="font-black uppercase text-[11px] tracking-widest">{tier.name}</span>
                            <Switch checked={enabled} onCheckedChange={checked => toggleTier(tier.id, checked)} />
                          </div>
                          {enabled && (
                            <div className="grid grid-cols-2 gap-3 px-4 pb-4">
                              <div className="space-y-1">
                                <Label className="text-[8px] font-black uppercase text-muted-foreground opacity-60">Price</Label>
                                <div className="relative">
                                  <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-primary" />
                                  <Input
                                    type="number"
                                    step="0.01"
                                    value={tierData?.price || ''}
                                    onChange={e => updateTier(tier.id, 'price', parseFloat(e.target.value) || 0)}
                                    className="h-9 pl-6 rounded-lg border-2 font-black font-mono text-xs"
                                  />
                                </div>
                              </div>
                              <div className="space-y-1">
                                <Label className="text-[8px] font-black uppercase text-muted-foreground opacity-60">Duration (min)</Label>
                                <Input
                                  type="number"
                                  value={tierData?.durationMinutes || ''}
                                  onChange={e => updateTier(tier.id, 'durationMinutes', parseInt(e.target.value) || 0)}
                                  className="h-9 rounded-lg border-2 font-black font-mono text-xs text-center"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground px-1">Booking Deposit</p>
                <Controller name="depositType" control={control} render={({ field }) => (
                  <RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 gap-2">
                    {(['none', 'deposit', 'breakeven', 'full'] as const).map(t => (
                      <label key={t} htmlFor={`dep-${t}-${service?.id || 'new'}`} className="cursor-pointer">
                        <div className={cn(
                          'flex items-center justify-center p-3 rounded-xl border-2 transition-all text-center',
                          field.value === t ? 'border-primary bg-primary/5 shadow-sm' : 'border-slate-100 bg-white hover:border-primary/20'
                        )}>
                          <span className="text-[9px] font-black uppercase tracking-widest">{t === 'breakeven' ? 'Overhead' : t}</span>
                          <RadioGroupItem value={t} id={`dep-${t}-${service?.id || 'new'}`} className="sr-only" />
                        </div>
                      </label>
                    ))}
                  </RadioGroup>
                )} />
                <AnimatePresence>
                  {['deposit', 'breakeven'].includes(depositType || '') && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                      <div className="grid grid-cols-2 gap-3 pt-1">
                        {depositType === 'deposit' && (
                          <div className="space-y-1.5">
                            <Label className="text-[9px] font-black uppercase text-muted-foreground">Calculation</Label>
                            <Controller name="depositSubType" control={control} render={({ field }) => (
                              <Select onValueChange={field.onChange} value={field.value}>
                                <SelectTrigger className="h-10 rounded-xl border-2 font-bold text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent className="rounded-xl border-2"><SelectItem value="flat" className="font-bold">Flat Rate</SelectItem><SelectItem value="percentage" className="font-bold">Percentage</SelectItem></SelectContent>
                              </Select>
                            )} />
                          </div>
                        )}
                        <div className="space-y-1.5">
                          <Label className="text-[9px] font-black uppercase text-muted-foreground">Amount</Label>
                          <div className="relative">
                            <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-primary" />
                            <Controller name="depositAmount" control={control} render={({ field }) => (
                              <Input type="number" step="0.01" {...field} value={field.value ?? ''} disabled={depositType === 'breakeven'} className="h-10 pl-7 rounded-xl border-2 font-black font-mono" />
                            )} />
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </section>

            <Separator />

            <section className="space-y-3">
              <SectionLabel>Required Consent Forms</SectionLabel>
              <InlineSearchPanel
                label="Consent Forms"
                icon={ListChecks}
                items={consentForms || []}
                selectedIds={selectedFormIds}
                onToggle={toggleForm}
                searchPlaceholder="Search forms..."
                emptyText="No consent forms configured"
                renderItem={(item, selected) => (
                  <span className="font-bold uppercase text-[10px] text-slate-700 flex-1 truncate">{(item as any).title || item.name || 'Untitled form'}</span>
                )}
              />
            </section>

            <Separator />

            {/* v2 — NEW: Required Documents. Mirrors the consent-forms
                section above, but these are custom, ad-hoc entries rather
                than picks from an existing library — a service just needs
                "Photo ID" or "Doctor's note," not a reference to a shared
                document definition. Configured once here, every booking
                path (staff call-in, self-service, and any automated
                booking agent) can read requiredFileRequirements directly
                off the service instead of a human needing to remember to
                ask case by case. persistToProfile mirrors the same field
                already used in bookingCompletions.fileRequirements — "On
                File" means signed/uploaded once, valid for future visits;
                "Every Time" means re-requested at every booking. */}
            <section className="space-y-3">
              <SectionLabel>Required Documents</SectionLabel>
              <div className="space-y-2">
                {fileRequirements.length === 0 && (
                  <p className="text-center py-4 text-[10px] font-black uppercase text-slate-400">No documents required for this service</p>
                )}
                {fileRequirements.map((fr: any) => (
                  <div key={fr.id} className="flex items-center gap-3 p-3 rounded-xl border-2 border-slate-100 bg-white">
                    <FileText className="w-4 h-4 text-primary/40 shrink-0" />
                    <p className="flex-1 min-w-0 font-bold uppercase text-[11px] text-slate-700 truncate">{fr.label}</p>
                    <button
                      type="button"
                      onClick={() => updateFileRequirement(fr.id, { persistToProfile: !fr.persistToProfile })}
                      className={cn(
                        'h-7 px-2.5 rounded-lg text-[8px] font-black uppercase border-2 shrink-0 transition-colors',
                        fr.persistToProfile ? 'border-primary/30 bg-primary/5 text-primary' : 'border-slate-200 text-slate-400',
                      )}
                    >
                      {fr.persistToProfile ? 'On File' : 'Every Time'}
                    </button>
                    <button type="button" onClick={() => removeFileRequirement(fr.id)} className="text-destructive shrink-0 p-1">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button" variant="outline" size="sm"
                  onClick={() => addFileRequirement('Photo ID', true)}
                  disabled={fileRequirements.some((f: any) => f.label === 'Photo ID')}
                  className="h-8 rounded-xl border-2 font-black uppercase text-[9px] tracking-tight bg-white shadow-sm"
                >
                  <Plus className="w-3 h-3 mr-1" /> Photo ID
                </Button>
              </div>

              <div className="flex gap-2 items-center">
                <Input
                  value={newFileReqLabel}
                  onChange={e => setNewFileReqLabel(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { addFileRequirement(newFileReqLabel, newFileReqPersist); setNewFileReqLabel(''); setNewFileReqPersist(false); } }}
                  placeholder="e.g. Doctor's note, referral..."
                  className="h-10 rounded-xl border-2 text-[11px] flex-1"
                />
                <button
                  type="button"
                  onClick={() => setNewFileReqPersist(v => !v)}
                  title="Save to client profile — don't ask again"
                  className={cn(
                    'h-10 px-3 rounded-xl border-2 text-[8px] font-black uppercase shrink-0 transition-colors',
                    newFileReqPersist ? 'border-primary/30 bg-primary/5 text-primary' : 'border-slate-200 text-slate-400',
                  )}
                >
                  On File
                </button>
                <Button
                  type="button"
                  onClick={() => { addFileRequirement(newFileReqLabel, newFileReqPersist); setNewFileReqLabel(''); setNewFileReqPersist(false); }}
                  disabled={!newFileReqLabel.trim()}
                  className="h-10 px-4 rounded-xl font-black uppercase text-[9px] tracking-widest shrink-0"
                >
                  Add
                </Button>
              </div>
            </section>

            <Separator />

            <section className="space-y-4">
              <SectionLabel>Policy & Compliance</SectionLabel>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Cancel Window (hrs)</Label>
                  <Input type="number" placeholder="Studio default" {...register('cancellationWindowHours')} className="h-11 rounded-xl border-2 font-black text-center" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Override Fee ($)</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-primary opacity-40" />
                    <Input type="number" step="0.01" placeholder="Matrix" {...register('customCancellationFee')} className="h-11 pl-7 rounded-xl border-2 font-black font-mono" />
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Confirmation Message</Label>
                <Textarea {...register('confirmationMessage')} placeholder="Post-booking instructions for the guest..." className="rounded-2xl border-2 min-h-[80px]" />
              </div>

              <div className="flex items-center justify-between p-4 rounded-2xl border-2 border-dashed border-slate-200">
                <div>
                  <p className="font-black uppercase text-sm tracking-tight">Private Listing</p>
                  <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">Hide from public booking</p>
                </div>
                <Controller name="isPrivate" control={control} render={({ field }) => (
                  <Switch checked={!!field.value} onCheckedChange={field.onChange} />
                )} />
              </div>
            </section>

          </div>
        </ScrollArea>

        <div className="shrink-0 border-t bg-background px-6 py-4 flex gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="flex-1 h-14 rounded-2xl font-black uppercase tracking-widest border-2"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit(onSubmit)}
            disabled={saving}
            className="flex-[2] h-14 rounded-2xl font-black uppercase tracking-widest shadow-xl shadow-primary/20"
          >
            {saving ? <Loader className="w-5 h-5 animate-spin" /> : mode === 'add' ? 'Save Service' : 'Commit Changes'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export const AddServiceDialog: React.FC<any> = ({ open, onOpenChange, initialType, categories, onNewCategory, onServiceAdded, resources, services }) => (
  <ServiceFormSheet open={open} onOpenChange={onOpenChange} mode="add" initialType={initialType} categories={categories} onNewCategory={onNewCategory} resources={resources} services={services} onSave={onServiceAdded} />
);

export const EditServiceDialog: React.FC<any> = ({ open, onOpenChange, service, onServiceUpdated, categories, onNewCategory, resources }) => {
  const { services } = useInventory();
  return (
    <ServiceFormSheet open={open} onOpenChange={onOpenChange} mode="edit" service={service} categories={categories} onNewCategory={onNewCategory} resources={resources} services={services} onSave={onServiceUpdated} />
  );
};
