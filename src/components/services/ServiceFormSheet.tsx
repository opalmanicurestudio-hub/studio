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

import { costGap } from '@/lib/product-cost';
import { SettingsStyle } from '@/components/settings/settings-style';
import { type Phase, type PhaseKind, type Requirement, type RequirementKind, type RequirementMode, PHASE_LABEL, PHASE_HINT, REQ_LABEL, MODE_LABEL, phasesFromService, newPhase, newRequirement, deriveTimings, nextBlueprint } from '@/lib/blueprint';
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
  // Where it happens — at the studio (default), online (with a link), or at the client's place.
  where: z.enum(['studio', 'online', 'phone', 'client']).optional(),
  phoneWho: z.enum(['we_call', 'they_call']).optional(),
  clientChoosesPlace: z.boolean().optional(),
  placeAlternatives: z.array(z.enum(['studio', 'online', 'phone', 'client'])).optional(),
  meetingLink: z.string().max(500).optional(),
  isAddon: z.boolean().optional(),
  category: z.string().min(1, 'Category is required'),
  duration: z.coerce.number().min(1, 'Duration required'),
  timedBy: z.enum(['provider', 'booking', 'none']).optional(),   // how this service is timed (see the field below)
  taxExempt: z.boolean().optional(),                             // "not taxed" — some services are exempt where the business is
  priceIsFrom: z.boolean().optional(),                             // shown as "from $X" — the final price is agreed at the visit
  memberPrice: z.coerce.number().min(0).optional().nullable(),   // what members pay (blank = the normal price)
  padBefore: z.coerce.number().optional(),
  padAfter: z.coerce.number().optional(),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
  isPrivate: z.boolean().optional(),
  membersOnly: z.boolean().optional(),
  rebookWeeks: z.coerce.number().min(0).max(52).optional(),
  returnServiceId: z.string().optional(),
  returnMinWeeks: z.coerce.number().min(0).max(52).optional(),
  returnMaxWeeks: z.coerce.number().min(0).max(52).optional(),
  lateServiceId: z.string().optional(),
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
    <div className="rounded-2xl border border-slate-100 bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-primary/40 shrink-0" />
          <span className="font-semibold text-[11px] text-slate-700">{label}</span>
          {selectedCount > 0 && (
            <Badge className="bg-primary text-white border-none font-semibold text-[12px] h-4 px-1.5">{selectedCount}</Badge>
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
                  className="w-full h-9 pl-8 pr-3 rounded-xl border border-slate-100 bg-slate-50 text-[11px] font-bold tracking-tight outline-none focus:border-primary/30"
                />
              </div>
              <div className="max-h-52 overflow-y-auto space-y-1">
                {filtered.length === 0 && (
                  <p className="text-center py-6 text-[12px] font-semibold text-slate-400">{emptyText}</p>
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
                        'w-5 h-5 rounded-lg border flex items-center justify-center shrink-0 transition-all',
                        selected ? 'bg-primary border-primary' : 'border-slate-300'
                      )}>
                        {selected && <Check className="w-3 h-3 text-white" />}
                      </div>
                      {renderItem
                        ? renderItem(item, selected)
                        : <span className="font-bold text-[12px] text-slate-700 flex-1">{displayLabel}</span>}
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

const anchorId = (t: any) => `svc-${String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`;
const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <p id={anchorId(children)} className="text-[15px] font-semibold px-1 mb-3 scroll-mt-20">{children}</p>
);
const FORM_STEPS: [string, string][] = [['Basics', 'Basics'], ['Products it uses', 'Products'], ['Price & deposit', 'Price'], ['Consent forms', 'Forms'], ['Policies & online booking', 'Policies']];

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
    <div className="rounded-2xl border border-primary/10 bg-primary/[0.02] p-4 space-y-2">
      <p className="text-[12px] font-semibold text-primary/60 flex items-center gap-1.5"><Target className="w-3 h-3" />Recovery Targets</p>
      {rows.map(r => (
        <div key={r.id} className="flex justify-between items-center">
          <span className="text-[12px] font-bold text-slate-600">{r.name}</span>
          <span className="font-semibold font-mono text-sm text-primary">${r.target.toFixed(2)}</span>
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
  const allServices: any[] = ((useInventory() as any).services || []) as any[];   // for the return plan pickers
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
        where: ((service as any).where || 'studio') as any, meetingLink: (service as any).meetingLink || '', phoneWho: ((service as any).phoneWho || 'we_call') as any, clientChoosesPlace: (service as any).clientChoosesPlace === true, placeAlternatives: Array.isArray((service as any).placeAlternatives) ? (service as any).placeAlternatives : [],
        isAddon: service.type === 'addon', isPrivate: service.isPrivate, membersOnly: service.membersOnly === true, rebookWeeks: Number(service.rebookWeeks) || 0, returnServiceId: (service as any).returnServiceId || '', returnMinWeeks: Number((service as any).returnMinWeeks) || 0, returnMaxWeeks: Number((service as any).returnMaxWeeks) || 0, lateServiceId: (service as any).lateServiceId || '',
        category: service.category, duration: service.duration, timedBy: ((service as any).timedBy || 'provider') as any, taxExempt: !!(service as any).taxExempt, priceIsFrom: !!(service as any).priceIsFrom, memberPrice: (service as any).memberPrice ?? null,
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
    const markup = (selectedTenant as any)?.restocking?.enabled === true ? (Number((selectedTenant as any)?.restocking?.markupPct) || 40) / 100 : 0;   // restocking fund markup on product
    return (total / 60) * tmhr + mat * (1 + markup);
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

  // ── How it's delivered (service blueprint) — phases + requirements; the timing fields are derived from it on save.
  const [bpOn, setBpOn] = useState<boolean>(!!(service as any)?.blueprint?.phases?.length);
  const [bpPhases, setBpPhases] = useState<Phase[]>(() => (service as any)?.blueprint?.phases?.length ? (service as any).blueprint.phases : phasesFromService(service || {}));
  const [bpReqs, setBpReqs] = useState<Requirement[]>(() => (service as any)?.blueprint?.requirements || []);
  const bpT = deriveTimings(bpPhases);
  const setPhase = (i: number, patch: Partial<Phase>) => setBpPhases((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const movePhase = (i: number, d: number) => setBpPhases((ps) => { const n = [...ps]; const j = i + d; if (j < 0 || j >= n.length) return ps; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const setReq = (i: number, patch: Partial<Requirement>) => setBpReqs((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  useEffect(() => {   // opening a different service resets the blueprint to that service's
    const bp = (service as any)?.blueprint; setBpOn(!!bp?.phases?.length);
    setBpPhases(bp?.phases?.length ? bp.phases : phasesFromService(service || {})); setBpReqs(bp?.requirements || []);
  }, [service?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
      // The return plan (Book your next visit) — blanks mean "the same service" / "no change", never undefined.
      returnServiceId: data.returnServiceId || null, lateServiceId: data.lateServiceId || null,
      returnMinWeeks: Math.max(0, Math.min(52, Number(data.returnMinWeeks) || 0)), returnMaxWeeks: Math.max(0, Math.min(52, Number(data.returnMaxWeeks) || 0)),
      // Blueprint on → its phases decide duration and the set-up / clean-up buffers (one source of truth for booking).
      ...(bpOn && bpPhases.length ? (() => { const bp = nextBlueprint((service as any)?.blueprint, bpPhases, bpReqs); const d = deriveTimings(bp.phases); return { blueprint: bp, duration: d.duration || data.duration, padBefore: d.padBefore, padAfter: d.padAfter }; })() : {}),
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
        className="cf-settings cf-legacy w-full sm:max-w-2xl p-0 border-none bg-background flex flex-col overflow-hidden"
      >
        <SettingsStyle />
        <SheetHeader className="px-6 pt-6 pb-4 border-b shrink-0" style={{ background: 'var(--card)' }}>
          <SheetTitle className="text-[26px] font-light leading-none tracking-tight">
            {mode === 'add' ? 'New service' : (values.name || 'Edit service')}
          </SheetTitle>
          <SheetDescription className="text-[14px] cf-muted mt-1">
            {/* the live summary — what this service is, at a glance */}
            {[`${values.duration || 0} min${(values.padBefore || 0) + (values.padAfter || 0) ? ` (+${(values.padBefore || 0) + (values.padAfter || 0)} set-up/clean-up)` : ''}`, `$${Number(values.price || 0).toFixed(2)}`,
              Number(values.price) > 0 ? `${Math.round(((Number(values.price) - breakEven) / Number(values.price)) * 100)}% margin after time and product` : 'no price yet'].join(' · ')}
          </SheetDescription>
          {Object.keys(errors).length > 0 && <p className="text-[13px] font-semibold" style={{ color: 'var(--warn, #b45309)' }} role="alert">
            Please check: {Object.keys(errors).map((k) => ({ name: 'Name', category: 'Category', duration: 'Duration', price: 'Price', serviceTiers: 'Prices by tier', products: 'Products' } as any)[k] || k).join(', ')}
          </p>}
        </SheetHeader>

        <div className="flex gap-1.5 overflow-x-auto border-b px-6 py-2" style={{ background: 'var(--card)' }} aria-label="Jump to">
          {FORM_STEPS.map(([title, short]) => <button key={title} type="button" onClick={() => document.getElementById(anchorId(title))?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="h-9 shrink-0 rounded-full px-4 text-[13px] font-semibold" style={{ background: 'var(--soft)' }}>{short}</button>)}
        </div>
        <ScrollArea className="flex-1">
          <div className="px-6 py-6 space-y-8 pb-32">

            <section className="space-y-4">
              <SectionLabel>Basics</SectionLabel>

              <div className="flex items-center justify-between p-4 rounded-2xl border border-slate-100 bg-white">
                <div>
                  <p className="font-semibold text-sm tracking-tight">This is an add-on</p>
                  <p className="text-[12px] font-bold text-muted-foreground opacity-60">Offered alongside a main service, not booked on its own</p>
                </div>
                <Controller name="isAddon" control={control} render={({ field }) => (
                  <Switch checked={!!field.value} onCheckedChange={checked => { field.onChange(checked); setValue('type', checked ? 'addon' : 'service'); }} />
                )} />
              </div>

              <div className="space-y-1.5">
                <Label className="text-[12px] font-semibold text-muted-foreground">Name</Label>
                <Input {...register('name')} placeholder="e.g., SIGNATURE BLOWOUT" className="h-14 rounded-2xl border font-semibold text-lg tracking-tight" />
                {errors.name && <p className="text-[12px] font-semibold text-destructive">{errors.name.message}</p>}
              </div>

              <div className="space-y-1.5">
                <Label className="text-[12px] font-semibold text-muted-foreground">Category</Label>
                {isAddingCategory ? (
                  <div className="flex gap-2">
                    <Input
                      placeholder="NEW CATEGORY NAME"
                      value={newCategoryName}
                      onChange={e => setNewCategoryName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleNewCategory()}
                      className="h-12 rounded-xl border font-semibold text-xs flex-1"
                    />
                    <Button type="button" onClick={handleNewCategory} className="h-12 px-4 rounded-xl"><Check className="w-4 h-4" /></Button>
                    <Button type="button" variant="ghost" onClick={() => setIsAddingCategory(false)} className="h-12 px-4 rounded-xl"><X className="w-4 h-4" /></Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Controller name="category" control={control} render={({ field }) => (
                      <Select onValueChange={field.onChange} value={field.value}>
                        <SelectTrigger className="h-12 rounded-xl border font-semibold text-[12px] flex-1"><SelectValue placeholder="Select category" /></SelectTrigger>
                        <SelectContent className="rounded-xl border shadow-2xl">
                          {(categories || []).map(c => <SelectItem key={c} value={c} className="font-bold text-[12px]">{c}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )} />
                    <Button type="button" variant="outline" onClick={() => setIsAddingCategory(true)} className="h-12 w-12 rounded-xl border shrink-0"><Plus className="w-4 h-4" /></Button>
                  </div>
                )}
                {errors.category && <p className="text-[12px] font-semibold text-destructive">{errors.category.message}</p>}
              </div>

              <div className="grid grid-cols-3 gap-3">
                {[
                  { key: 'duration',  label: 'Duration (min)', placeholder: '60' },
                  { key: 'padBefore', label: 'Set-up before (min)', placeholder: '0' },
                  { key: 'padAfter',  label: 'Clean-up after (min)', placeholder: '15' },
                ].map(({ key, label, placeholder }) => (
                  <div key={key} className="space-y-1.5 text-center">
                    <Label className="text-[12px] font-semibold text-muted-foreground">{label}</Label>
                    <Input
                      type="number"
                      placeholder={placeholder}
                      {...register(key as any)}
                      className="h-12 rounded-xl border font-semibold text-center text-lg"
                    />
                  </div>

                ))}
              </div>
              {/* How it's timed — decides whether provider times, "why did it run over?" and overtime apply, or
                  overstay rules (rentals), or nothing (classes, events). */}
              <div className="space-y-1.5">
                <Label className="text-[12px] font-semibold text-muted-foreground">How is this timed?</Label>
                <select {...register('timedBy' as any)} className="h-12 w-full rounded-xl border bg-background px-3 text-[15px] font-semibold">
                  <option value="provider">By the provider — work someone does (nails, hair, massage)</option>
                  <option value="booking">By the booking — time someone uses (sauna, room, court, equipment)</option>
                  <option value="none">Not timed — classes, events, pickups</option>
                </select>
                <p className="text-[11px] text-muted-foreground">By the provider: each provider’s typical times and “why did it run over?” apply. By the booking: overstay rules apply instead, never provider questions.</p>
              </div>
              {errors.duration && <p className="text-[12px] font-semibold text-destructive text-center">{errors.duration.message}</p>}

              <div className="space-y-1.5">
                <Label className="text-[12px] font-semibold text-muted-foreground">Description</Label>
                <Textarea {...register('description')} placeholder="Describe the service..." className="rounded-2xl border min-h-[80px]" />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Where it happens</Label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {([['studio', 'In person'], ['online', 'Video call'], ['phone', 'Phone call'], ['client', 'At the client’s location']] as const).map(([k, l]) => {
                    const on = (watch('where') || 'studio') === k;
                    return <button key={k} type="button" aria-pressed={on} onClick={() => setValue('where', k, { shouldDirty: true })} className={`h-11 rounded-xl border text-sm ${on ? 'bg-slate-900 text-white' : 'bg-white'}`}>{l}</button>;
                  })}
                </div>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!watch('clientChoosesPlace')} onChange={(e) => setValue('clientChoosesPlace', e.target.checked, { shouldDirty: true })} /> Clients can choose</label>
                {watch('clientChoosesPlace') && <div className="flex flex-wrap gap-3 text-sm">
                  <span className="text-muted-foreground">Also offer:</span>
                  {([['studio', 'In person'], ['online', 'Video call'], ['phone', 'Phone call'], ['client', 'At the client’s location']] as const).filter(([k]) => k !== (watch('where') || 'studio')).map(([k, l]) => {
                    const cur: string[] = (watch('placeAlternatives') as any) || [];
                    return <label key={k} className="flex items-center gap-1.5"><input type="checkbox" checked={cur.includes(k)} onChange={(e) => setValue('placeAlternatives', (e.target.checked ? [...cur, k] : cur.filter((x) => x !== k)) as any, { shouldDirty: true })} /> {l}</label>;
                  })}
                  <span className="w-full text-xs text-muted-foreground">When booking, clients pick how to meet. Video and phone calls are paid in full when booked (Booking policies).</span>
                </div>}
                {(watch('where') === 'online' || (watch('clientChoosesPlace') && ((watch('placeAlternatives') as any) || []).includes('online'))) && <Input {...register('meetingLink')} placeholder="Meeting link — e.g. https://zoom.us/j/…" className="h-11 rounded-xl border" />}
                {(watch('where') === 'phone' || (watch('clientChoosesPlace') && ((watch('placeAlternatives') as any) || []).includes('phone'))) && <div className="grid grid-cols-2 gap-2">
                  {([['we_call', 'We call them'], ['they_call', 'They call us']] as const).map(([k, l]) => {
                    const on = (watch('phoneWho') || 'we_call') === k;
                    return <button key={k} type="button" aria-pressed={on} onClick={() => setValue('phoneWho', k, { shouldDirty: true })} className={`h-10 rounded-xl border text-sm ${on ? 'bg-slate-900 text-white' : 'bg-white'}`}>{l}</button>;
                  })}
                </div>}
                <p className="text-xs text-muted-foreground">{
                  watch('where') === 'online' ? 'Every booking of this service gets this link, so use a meeting room with a waiting room or passcode — or give a booking its own link from its appointment details. Clients get it in their confirmation, reminder and visit link; times show your time zone.'
                  : watch('where') === 'phone' ? ((watch('phoneWho') || 'we_call') === 'we_call' ? 'You call the client at their appointment time — they must give a phone number when booking. No check-in; times show your time zone.' : 'The client calls your business number at their appointment time — it’s on their visit link. No check-in; times show your time zone.')
                  : watch('where') === 'client' ? 'You go to them. Messages say you’ll come to them (with their address, if it’s on file) — no check-in.'
                  : 'At your business — clients check in when they arrive.'}</p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[12px] font-semibold text-muted-foreground">Photo for the menu</Label>
                <Controller name="imageUrl" control={control} render={({ field }) => (
                  <ImageUpload onImageUploaded={field.onChange} initialImage={field.value} />
                )} />
              </div>
            </section>

            <Separator />

            <section className="space-y-3">
              <SectionLabel>Products it uses</SectionLabel>
              {(() => { const gaps = selectedProducts.map((p: any) => ({ p, it: (inventory || []).find((x: any) => x.id === p.id || x.id === p.productId) })).map(({ p, it }: any) => ({ name: it?.name || p.name || 'Product', gap: costGap(it) })).filter((x: any) => x.gap);
                return gaps.length ? <p className="mb-3 rounded-2xl px-4 py-3 text-[13px]" style={{ background: 'rgba(180,83,9,.1)', color: '#8a3f06' }}>{gaps.length === 1 ? `${gaps[0].name} has ${gaps[0].gap} — the margin above and the restocking fund can’t count it yet.` : `${gaps.length} products can’t be counted yet (${gaps.map((g: any) => `${g.name}: ${g.gap}`).join('; ')}).`} Fix them in Inventory.</p> : null; })()}
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
                    <span className="font-bold text-[12px] text-slate-700 truncate">{item.name || 'Untitled'}</span>
                    <span className="text-[12px] font-semibold text-primary/50 shrink-0">
                      {(item as any).costingMethod === 'uses' ? (item as any).useUnit || 'uses' : (item as any).unit || 'unit'}
                    </span>
                  </div>
                )}
              />
              {selectedProducts.length > 0 && (
                <div className="space-y-2 pt-1">
                  <p className="text-[12px] font-semibold text-muted-foreground opacity-50 px-1">Quantities</p>
                  {selectedProducts.map((product: any, index: number) => {
                    const inv = inventory.find(i => i.id === product.id);
                    const unit = inv?.costingMethod === 'uses' ? (inv.useUnit || 'uses') : (inv?.unit || 'ml');
                    return (
                      <div key={product.id} className="flex items-center gap-3 p-3 rounded-xl border border-slate-100 bg-white">
                        <span className="font-semibold text-[12px] text-slate-700 flex-1 truncate">{product.name || 'Untitled'}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <Input
                            type="number"
                            value={product.quantityUsed || ''}
                            onChange={e => {
                              const next = [...selectedProducts];
                              next[index] = { ...product, quantityUsed: parseFloat(e.target.value) || 0 };
                              setValue('products', next, { shouldDirty: true });
                            }}
                            className="w-16 h-8 rounded-lg border text-center font-semibold font-mono text-xs"
                            step="0.1"
                          />
                          <span className="text-[12px] font-semibold text-muted-foreground w-8 opacity-60">{unit}</span>
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
                  <SectionLabel>Add-ons offered with it</SectionLabel>
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
                        <span className="font-bold text-[12px] text-slate-700 truncate">{item.name || 'Untitled'}</span>
                        <span className="text-[12px] font-semibold text-primary/50 shrink-0">{(item as any).duration}m · ${((item as any).price || 0).toFixed(0)}</span>
                      </div>
                    )}
                  />
                </section>
              </>
            )}

            <Separator />
            <section className="space-y-3">
              <SectionLabel>Rooms & equipment it needs</SectionLabel>
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
              <SectionLabel>Price & deposit</SectionLabel>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between px-1">
                  <Label className="text-[12px] font-semibold text-muted-foreground">Price</Label>
                  <span className="text-[12px] font-semibold text-destructive uppercase">Breakeven: ${breakEven.toFixed(2)}</span>
                </div>
                <div className="relative">
                  <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-primary opacity-40" />
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    {...register('price')}
                    className="h-12 pl-11 rounded-2xl border font-semibold text-xl text-primary"
                  />
                </div>
                {errors.price && <p className="text-[12px] font-semibold text-destructive">{errors.price.message}</p>}
              </div>
              {/* How the price behaves: shown as "from", tax, and what members pay. */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="flex items-center gap-3 rounded-2xl border p-3 text-[14px]"><input type="checkbox" {...register('priceIsFrom' as any)} className="h-5 w-5" /><span>Show as <b>“from”</b> — the final price is agreed at the visit</span></label>
                <label className="flex items-center gap-3 rounded-2xl border p-3 text-[14px]"><input type="checkbox" {...register('taxExempt' as any)} className="h-5 w-5" /><span><b>Not taxed</b> — leave this out of sales tax</span></label>
                <div className="space-y-1.5"><Label className="text-[12px] font-semibold text-muted-foreground">Member price ($)</Label>
                  <Input type="number" step="0.01" placeholder="Same as price" {...register('memberPrice' as any)} className="h-12 rounded-xl border" /><p className="text-[11px] text-muted-foreground">For clients with an active membership. Blank = the normal price.</p></div>
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
                  <p className="text-[12px] font-semibold text-muted-foreground px-1">Skill Tier Overrides</p>
                  <div className="space-y-2">
                    {[...(pricingTiers || [])].sort((a, b) => (a.rank || 0) - (b.rank || 0)).map(tier => {
                      const tierData = serviceTiers.find((t: any) => t.tierId === tier.id);
                      const enabled  = !!tierData;
                      return (
                        <div key={tier.id} className={cn('rounded-2xl border overflow-hidden transition-all', enabled ? 'border-primary/30 bg-primary/[0.02]' : 'border-slate-100 opacity-60')}>
                          <div className="flex items-center justify-between px-4 py-3">
                            <span className="font-semibold text-[11px]">{tier.name}</span>
                            <Switch checked={enabled} onCheckedChange={checked => toggleTier(tier.id, checked)} />
                          </div>
                          {enabled && (
                            <div className="grid grid-cols-2 gap-3 px-4 pb-4">
                              <div className="space-y-1">
                                <Label className="text-[12px] font-semibold text-muted-foreground opacity-60">Price</Label>
                                <div className="relative">
                                  <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-primary" />
                                  <Input
                                    type="number"
                                    step="0.01"
                                    value={tierData?.price || ''}
                                    onChange={e => updateTier(tier.id, 'price', parseFloat(e.target.value) || 0)}
                                    className="h-9 pl-6 rounded-lg border font-semibold font-mono text-xs"
                                  />
                                </div>
                              </div>
                              <div className="space-y-1">
                                <Label className="text-[12px] font-semibold text-muted-foreground opacity-60">Duration (min)</Label>
                                <Input
                                  type="number"
                                  value={tierData?.durationMinutes || ''}
                                  onChange={e => updateTier(tier.id, 'durationMinutes', parseInt(e.target.value) || 0)}
                                  className="h-9 rounded-lg border font-semibold font-mono text-xs text-center"
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
                <p className="text-[12px] font-semibold text-muted-foreground px-1">Booking Deposit</p>
                <Controller name="depositType" control={control} render={({ field }) => (
                  <RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 gap-2">
                    {(['none', 'deposit', 'breakeven', 'full'] as const).map(t => (
                      <label key={t} htmlFor={`dep-${t}-${service?.id || 'new'}`} className="cursor-pointer">
                        <div className={cn(
                          'flex items-center justify-center p-3 rounded-xl border transition-all text-center',
                          field.value === t ? 'border-primary bg-primary/5 shadow-sm' : 'border-slate-100 bg-white hover:border-primary/20'
                        )}>
                          <span className="text-[12px] font-semibold">{t === 'breakeven' ? 'Overhead' : t}</span>
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
                            <Label className="text-[12px] font-semibold text-muted-foreground">Calculation</Label>
                            <Controller name="depositSubType" control={control} render={({ field }) => (
                              <Select onValueChange={field.onChange} value={field.value}>
                                <SelectTrigger className="h-10 rounded-xl border font-bold text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent className="rounded-xl border"><SelectItem value="flat" className="font-bold">Flat Rate</SelectItem><SelectItem value="percentage" className="font-bold">Percentage</SelectItem></SelectContent>
                              </Select>
                            )} />
                          </div>
                        )}
                        <div className="space-y-1.5">
                          <Label className="text-[12px] font-semibold text-muted-foreground">Amount</Label>
                          <div className="relative">
                            <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-primary" />
                            <Controller name="depositAmount" control={control} render={({ field }) => (
                              <Input type="number" step="0.01" {...field} value={field.value ?? ''} disabled={depositType === 'breakeven'} className="h-10 pl-7 rounded-xl border font-semibold font-mono" />
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
              <SectionLabel>Consent forms</SectionLabel>
              <InlineSearchPanel
                label="Consent Forms"
                icon={ListChecks}
                items={consentForms || []}
                selectedIds={selectedFormIds}
                onToggle={toggleForm}
                searchPlaceholder="Search forms..."
                emptyText="No consent forms configured"
                renderItem={(item, selected) => (
                  <span className="font-bold text-[12px] text-slate-700 flex-1 truncate">{(item as any).title || item.name || 'Untitled form'}</span>
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

            <Separator />

            <section className="space-y-4">
              <SectionLabel>Policies & online booking</SectionLabel>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[12px] font-semibold text-muted-foreground">Cancel window (hours)</Label>
                  <Input type="number" placeholder="Studio default" {...register('cancellationWindowHours')} className="h-11 rounded-xl border font-semibold text-center" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[12px] font-semibold text-muted-foreground">Fee if cancelled late ($)</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-primary opacity-40" />
                    <Input type="number" step="0.01" placeholder="Matrix" {...register('customCancellationFee')} className="h-11 pl-7 rounded-xl border font-semibold font-mono" />
                  </div>
                </div>
              </div>


              <div className="flex items-center justify-between p-4 rounded-2xl border border-slate-200">
                <div>
                  <p className="font-semibold text-sm tracking-tight">Hidden from the booking page</p>
                  <p className="text-[12px] font-bold text-muted-foreground opacity-60">Hide from public booking</p>
                </div>
                <Controller name="isPrivate" control={control} render={({ field }) => (
                  <Switch checked={!!field.value} onCheckedChange={field.onChange} />
                )} />
              </div>
              <div className="flex items-center justify-between p-4 rounded-2xl border border-violet-200 bg-violet-50/40">
                <div>
                  <p className="font-semibold text-sm tracking-tight">Members Only</p>
                  <p className="text-[12px] font-bold text-muted-foreground opacity-60">Hidden from non-members on the booking page, and refused if they try</p>
                </div>
                <Controller name="membersOnly" control={control} render={({ field }) => (
                  <Switch checked={!!field.value} onCheckedChange={field.onChange} />
                )} />
              </div>
              <div className="flex items-center justify-between gap-4 p-4 rounded-2xl border">
                <div>
                  <p className="font-semibold text-sm tracking-tight">Rebook every</p>
                  <p className="text-[12px] font-bold text-muted-foreground opacity-60">Weeks until a client is due again — drives the “you're due” nudge. 0 = off</p>
                </div>
                <Controller name="rebookWeeks" control={control} render={({ field }) => (
                  <Input type="number" min={0} max={52} value={field.value ?? 0} onChange={(e) => field.onChange(e.target.value)} className="h-11 w-20 rounded-xl border text-center font-semibold" />
                )} />
              </div>
            </section>

            {/* MORE OPTIONS — the parts most owners never touch, out of the way but one tap away. */}
            <details className="rounded-3xl p-4" style={{ background: 'var(--card)', border: '1px solid var(--line)' }}>
              <summary className="cursor-pointer text-[15px] font-semibold">More options <span className="font-normal cf-muted">— the confirmation note, documents to sign, how it’s delivered, the return plan</span></summary>
              <div className="space-y-6 pt-4">
              <div className="space-y-1.5">
                <Label className="text-[12px] font-semibold text-muted-foreground">Extra note in the confirmation</Label>
                <Textarea {...register('confirmationMessage')} placeholder="Post-booking instructions for the guest..." className="rounded-2xl border min-h-[80px]" />
              </div>
            <section className="space-y-3">
              <SectionLabel>Documents</SectionLabel>
              <div className="space-y-2">
                {fileRequirements.length === 0 && (
                  <p className="text-center py-4 text-[12px] font-semibold text-slate-400">No documents required for this service</p>
                )}
                {fileRequirements.map((fr: any) => (
                  <div key={fr.id} className="flex items-center gap-3 p-3 rounded-xl border border-slate-100 bg-white">
                    <FileText className="w-4 h-4 text-primary/40 shrink-0" />
                    <p className="flex-1 min-w-0 font-bold text-[11px] text-slate-700 truncate">{fr.label}</p>
                    <button
                      type="button"
                      onClick={() => updateFileRequirement(fr.id, { persistToProfile: !fr.persistToProfile })}
                      className={cn(
                        'h-7 px-2.5 rounded-lg text-[12px] font-semibold border shrink-0 transition-colors',
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
                  className="h-8 rounded-xl border font-semibold text-[12px] tracking-tight bg-white shadow-sm"
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
                  className="h-10 rounded-xl border text-[11px] flex-1"
                />
                <button
                  type="button"
                  onClick={() => setNewFileReqPersist(v => !v)}
                  title="Save to client profile — don't ask again"
                  className={cn(
                    'h-10 px-3 rounded-xl border text-[12px] font-semibold shrink-0 transition-colors',
                    newFileReqPersist ? 'border-primary/30 bg-primary/5 text-primary' : 'border-slate-200 text-slate-400',
                  )}
                >
                  On File
                </button>
                <Button
                  type="button"
                  onClick={() => { addFileRequirement(newFileReqLabel, newFileReqPersist); setNewFileReqLabel(''); setNewFileReqPersist(false); }}
                  disabled={!newFileReqLabel.trim()}
                  className="h-10 px-4 rounded-xl font-semibold text-[12px] shrink-0"
                >
                  Add
                </Button>
              </div>
            </section>
              <div className="space-y-3 p-4 rounded-2xl border">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="font-semibold text-sm tracking-tight">How it’s delivered</p>
                    <p className="text-[12px] font-bold text-muted-foreground opacity-60">Phases and what it needs — sets the timings for booking and station turnover</p></div>
                  <button type="button" onClick={() => setBpOn((v) => !v)} aria-pressed={bpOn} className={`h-8 shrink-0 rounded-full px-3 text-[11px] font-semibold ${bpOn ? 'bg-primary text-primary-foreground' : 'border'}`}>{bpOn ? 'On' : 'Set up'}</button>
                </div>
                {bpOn && (<div className="space-y-4">
                  <div className="space-y-2">
                    {bpPhases.map((p, i) => (
                      <div key={p.id} className="space-y-2 rounded-xl border p-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <select value={p.kind} onChange={(e) => setPhase(i, { kind: e.target.value as PhaseKind, label: p.label === PHASE_LABEL[p.kind] ? PHASE_LABEL[e.target.value as PhaseKind] : p.label })} className="h-10 rounded-xl border bg-background px-2 text-sm" aria-label="Phase type">
                            {(Object.keys(PHASE_LABEL) as PhaseKind[]).map((k) => <option key={k} value={k}>{PHASE_LABEL[k]}</option>)}
                          </select>
                          <Input value={p.label} onChange={(e) => setPhase(i, { label: e.target.value })} className="h-10 min-w-[8rem] flex-1 rounded-xl border" aria-label="Phase name" />
                          <Input type="number" min={0} max={600} value={p.minutes} onChange={(e) => setPhase(i, { minutes: Number(e.target.value) })} className="h-10 w-20 rounded-xl border text-center" aria-label="Minutes" />
                          <span className="text-xs text-muted-foreground">min</span>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={p.providerNeeded} onChange={(e) => setPhase(i, { providerNeeded: e.target.checked })} /> Provider needed</label>
                          <span className="flex gap-1">
                            <button type="button" onClick={() => movePhase(i, -1)} disabled={i === 0} className="h-8 w-8 rounded-lg border text-sm disabled:opacity-30" aria-label="Move up">↑</button>
                            <button type="button" onClick={() => movePhase(i, 1)} disabled={i === bpPhases.length - 1} className="h-8 w-8 rounded-lg border text-sm disabled:opacity-30" aria-label="Move down">↓</button>
                            <button type="button" onClick={() => setBpPhases((ps) => ps.filter((_, j) => j !== i))} disabled={bpPhases.length <= 1} className="h-8 rounded-lg border px-2 text-xs disabled:opacity-30">Remove</button>
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground">{PHASE_HINT[p.kind]}</p>
                      </div>))}
                    <div className="flex flex-wrap gap-2">{(Object.keys(PHASE_LABEL) as PhaseKind[]).map((k) => <button key={k} type="button" onClick={() => setBpPhases((ps) => [...ps, newPhase(k)])} className="h-9 rounded-full border px-3 text-xs font-semibold">+ {PHASE_LABEL[k]}</button>)}</div>
                    <p className="rounded-xl bg-muted/60 p-2.5 text-xs">Client {bpT.clientMinutes} min · provider {bpT.providerMinutes} min{bpT.providerFreeMinutes ? ` (free ${bpT.providerFreeMinutes} min while processing)` : ''} · station busy {bpT.stationMinutes} min{bpT.padAfter ? ` incl. ${bpT.padAfter} min turnover` : ''}</p>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-semibold tracking-tight">What it needs</p>
                    <p className="text-[11px] text-muted-foreground">Beyond the rooms and equipment above — tools and kits, linens, amenities, an extra person.</p>
                    {bpReqs.map((r, i) => (
                      <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-xl border p-2">
                        <select value={r.kind} onChange={(e) => setReq(i, { kind: e.target.value as RequirementKind })} className="h-10 rounded-xl border bg-background px-2 text-sm" aria-label="Kind">{(Object.keys(REQ_LABEL) as RequirementKind[]).map((k) => <option key={k} value={k}>{REQ_LABEL[k]}</option>)}</select>
                        <Input value={r.name} onChange={(e) => setReq(i, { name: e.target.value })} placeholder="e.g. Pedicure kit" className="h-10 min-w-[8rem] flex-1 rounded-xl border" aria-label="Name" />
                        <Input type="number" min={1} max={99} value={r.qty} onChange={(e) => setReq(i, { qty: Number(e.target.value) })} className="h-10 w-16 rounded-xl border text-center" aria-label="Quantity" />
                        <select value={r.mode} onChange={(e) => setReq(i, { mode: e.target.value as RequirementMode })} className="h-10 rounded-xl border bg-background px-2 text-sm" aria-label="How strictly">{(Object.keys(MODE_LABEL) as RequirementMode[]).map((k) => <option key={k} value={k}>{MODE_LABEL[k]}</option>)}</select>
                        <button type="button" onClick={() => setBpReqs((rs) => rs.filter((_, j) => j !== i))} className="h-10 rounded-xl border px-2 text-xs">Remove</button>
                      </div>))}
                    <button type="button" onClick={() => setBpReqs((rs) => [...rs, newRequirement()])} className="h-9 rounded-full border px-3 text-xs font-semibold">+ Add a requirement</button>
                  </div>
                  {(service as any)?.blueprint?.version ? <p className="text-[11px] text-muted-foreground">Version {(service as any).blueprint.version} · saving a change makes a new version; past bookings keep the one they were booked under.</p> : null}
                </div>)}
              </div>
              <div className="space-y-3 p-4 rounded-2xl border">
                <div><p className="font-semibold text-sm tracking-tight">Return plan</p>
                  <p className="text-[12px] font-bold text-muted-foreground opacity-60">What they book next, and when — used by “Book your next visit” on the client screen</p></div>
                <label className="block text-xs font-bold">Comes back for
                  <Controller name="returnServiceId" control={control} render={({ field }) => (
                    <select value={field.value || ''} onChange={(e) => field.onChange(e.target.value)} className="mt-1 h-11 w-full rounded-xl border bg-background px-3 text-sm" aria-label="Comes back for">
                      <option value="">This same service</option>
                      {(allServices || []).filter((x: any) => x.id !== service?.id && x.type !== 'addon').map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>)} /></label>
                <div className="flex flex-wrap items-center gap-2 text-xs font-bold">Within
                  <Controller name="returnMinWeeks" control={control} render={({ field }) => (<Input type="number" min={0} max={52} value={field.value || ''} placeholder="–" onChange={(e) => field.onChange(e.target.value)} className="h-10 w-16 rounded-xl border text-center" aria-label="From weeks" />)} />
                  to
                  <Controller name="returnMaxWeeks" control={control} render={({ field }) => (<Input type="number" min={0} max={52} value={field.value || ''} placeholder="–" onChange={(e) => field.onChange(e.target.value)} className="h-10 w-16 rounded-xl border text-center" aria-label="To weeks" />)} />
                  weeks <span className="font-normal text-muted-foreground">(blank = around “Rebook every”)</span></div>
                <label className="block text-xs font-bold">If they come back later than that, book
                  <Controller name="lateServiceId" control={control} render={({ field }) => (
                    <select value={field.value || ''} onChange={(e) => field.onChange(e.target.value)} className="mt-1 h-11 w-full rounded-xl border bg-background px-3 text-sm" aria-label="If later, book">
                      <option value="">No change</option>
                      {(allServices || []).filter((x: any) => x.type !== 'addon').map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>)} /></label>
              </div>
              </div>
            </details>

          </div>
        </ScrollArea>

        <div className="shrink-0 border-t bg-background px-6 py-4 flex gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="flex-1 h-14 rounded-2xl font-semibold border"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit(onSubmit)}
            disabled={saving}
            className="flex-[2] h-14 rounded-2xl font-semibold shadow-xl shadow-primary/20"
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
