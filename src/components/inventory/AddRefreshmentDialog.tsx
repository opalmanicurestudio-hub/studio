'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import {
  X, ChevronRight, ChevronLeft, Plus, Trash2, Package,
  DollarSign, BarChart3, Truck, Calculator, Check, Info,
  AlertTriangle, Eye, EyeOff, ChevronDown, Loader,
} from 'lucide-react';

// ─── TYPES ────────────────────────────────────────────────────────────────────
type DivideMethod = 'volume' | 'portions';

type RecipeIngredient = {
  id:       string;
  name:     string;
  cost:     number;
  unit:     string;
};

type FormData = {
  // Step 1 — basics
  name:           string;
  category:       string;
  description:    string;
  imageUrl:       string;
  guestPrice:     number;
  showOnMenu:     boolean;
  availableEvents: boolean;

  // Step 2 — stock & costs
  unitsOnHand:    number;
  unitLabel:      string;  // "bottle", "bag", "box", etc.

  divideMethod:   DivideMethod;
  // Volume
  unitVolumeMl:   number;
  portionVolumeMl: number;
  // Portions
  portionsPerUnit: number;

  // Landed cost
  purchasePrice:  number;
  orderQuantity:  number;
  deliveryCost:   number;
  otherFees:      number;

  // Recipe
  recipeIngredients: RecipeIngredient[];
};

type Props = {
  // Inventory page shape
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onRefreshmentAdded?: (item: any) => void;
  locations?: any[];
  // Direct shape (manifest etc.)
  isOpen?: boolean;
  onClose?: () => void;
  onSave?: (data: FormData) => Promise<void>;
  tenantId?: string;
  eventId?: string;
  initial?: Partial<FormData>;
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const currency = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
const pct      = (n: number) => `${Math.round(n)}%`;

const CATEGORIES = ['Beverages', 'Wine & Spirits', 'Beer & Cider', 'Non-Alcoholic', 'Snacks', 'Appetizers', 'Desserts', 'Other'];
const UNIT_LABELS = ['bottle', 'can', 'bag', 'box', 'carton', 'container', 'jar', 'pack', 'tray', 'case', 'keg', 'barrel'];

const DEFAULT: FormData = {
  name: '', category: 'Beverages', description: '', imageUrl: '',
  guestPrice: 0, showOnMenu: true, availableEvents: true,
  unitsOnHand: 0, unitLabel: 'bottle',
  divideMethod: 'volume', unitVolumeMl: 750, portionVolumeMl: 125, portionsPerUnit: 8,
  purchasePrice: 0, orderQuantity: 1, deliveryCost: 0, otherFees: 0,
  recipeIngredients: [],
};

// ─── LABEL + INPUT ─────────────────────────────────────────────────────────────
const Field = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => (
  <div className="space-y-1.5">
    <div className="flex items-center gap-1.5">
      <label className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400">{label}</label>
      {hint && (
        <div className="group relative">
          <Info className="w-3 h-3 text-slate-500 cursor-help" />
          <div className="absolute bottom-full left-0 mb-1 w-48 p-2 rounded-lg bg-slate-900 text-[9px] text-slate-300 font-bold hidden group-hover:block z-50 shadow-xl">
            {hint}
          </div>
        </div>
      )}
    </div>
    {children}
  </div>
);

const Input = ({ value, onChange, type = 'text', placeholder, prefix, suffix, className }: {
  value: string | number; onChange: (v: string) => void; type?: string;
  placeholder?: string; prefix?: string; suffix?: string; className?: string;
}) => (
  <div className={cn('flex items-center h-11 rounded-xl border-2 border-slate-100 bg-white overflow-hidden focus-within:border-slate-300 transition-all', className)}>
    {prefix && <span className="px-3 text-sm font-black text-slate-400 border-r border-slate-100">{prefix}</span>}
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="flex-1 h-full px-3 text-sm font-bold text-slate-800 outline-none bg-transparent placeholder:text-slate-300"
    />
    {suffix && <span className="px-3 text-sm font-black text-slate-400 border-l border-slate-100">{suffix}</span>}
  </div>
);

// ─── LIVE SUMMARY PANEL ───────────────────────────────────────────────────────
const LiveSummary = ({ data }: { data: FormData }) => {
  const totalOrderCost = useMemo(() => {
    return data.purchasePrice * data.orderQuantity + data.deliveryCost + data.otherFees;
  }, [data.purchasePrice, data.orderQuantity, data.deliveryCost, data.otherFees]);

  const landedCostPerUnit = useMemo(() => {
    if (data.orderQuantity <= 0) return 0;
    return totalOrderCost / data.orderQuantity;
  }, [totalOrderCost, data.orderQuantity]);

  const portionsPerUnit = useMemo(() => {
    if (data.divideMethod === 'portions') return data.portionsPerUnit;
    if (data.portionVolumeMl <= 0) return 0;
    return Math.floor(data.unitVolumeMl / data.portionVolumeMl);
  }, [data]);

  const totalPortions = portionsPerUnit * data.unitsOnHand;

  const costPerPortion = useMemo(() => {
    if (portionsPerUnit <= 0) return 0;
    return landedCostPerUnit / portionsPerUnit;
  }, [landedCostPerUnit, portionsPerUnit]);

  const ingredientCostPerPortion = useMemo(() => {
    if (data.recipeIngredients.length === 0) return 0;
    const total = data.recipeIngredients.reduce((s, i) => s + (i.cost || 0), 0);
    return total / Math.max(portionsPerUnit, 1);
  }, [data.recipeIngredients, portionsPerUnit]);

  const totalCostPerPortion = costPerPortion + ingredientCostPerPortion;

  const grossMargin = useMemo(() => {
    if (data.guestPrice <= 0) return null;
    return ((data.guestPrice - totalCostPerPortion) / data.guestPrice) * 100;
  }, [data.guestPrice, totalCostPerPortion]);

  const totalStockValue = landedCostPerUnit * data.unitsOnHand;
  const overheadPerUnit = data.orderQuantity > 0 ? (data.deliveryCost + data.otherFees) / data.orderQuantity : 0;

  const marginColor = grossMargin === null ? 'text-slate-400' :
    grossMargin >= 60 ? 'text-emerald-600' :
    grossMargin >= 30 ? 'text-amber-600' : 'text-red-500';

  const Row = ({ label, value, sub, bold, color }: { label: string; value: string; sub?: string; bold?: boolean; color?: string }) => (
    <div className="flex items-start justify-between gap-4">
      <span className={cn('text-[9px] font-bold uppercase tracking-widest text-slate-500', bold && 'font-black text-slate-700')}>{label}</span>
      <div className="text-right">
        <span className={cn('text-sm font-black text-slate-800', bold && 'text-base', color)}>{value}</span>
        {sub && <p className="text-[8px] font-bold text-slate-400">{sub}</p>}
      </div>
    </div>
  );

  return (
    <div className="bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 space-y-3">
      <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400">Live Summary</p>

      <div className="space-y-2">
        <Row label="Units on hand"      value={String(data.unitsOnHand || 0)} />
        {portionsPerUnit > 0 && (
          <Row label={`Portions per ${data.unitLabel}`} value={String(portionsPerUnit)}
            sub={data.divideMethod === 'volume' ? `${data.unitVolumeMl}ml ÷ ${data.portionVolumeMl}ml` : 'manual'} />
        )}
        <Row label="Total portions"     value={String(totalPortions || 0)} />
      </div>

      <div className="border-t border-slate-200 pt-3 space-y-2">
        <Row label="Total order cost"   value={currency(totalOrderCost)} />
        <Row label="Landed cost / unit" value={currency(landedCostPerUnit)}
          sub={overheadPerUnit > 0 ? `incl. ${currency(overheadPerUnit)} overhead` : undefined} bold />
        <Row label="Cost per portion"   value={currency(costPerPortion)} />
        {ingredientCostPerPortion > 0 && (
          <Row label="Recipe cost / portion" value={currency(ingredientCostPerPortion)} />
        )}
        {ingredientCostPerPortion > 0 && (
          <Row label="Total cost / portion" value={currency(totalCostPerPortion)} bold />
        )}
        <Row label="Total stock value"  value={currency(totalStockValue)} />
      </div>

      {data.guestPrice > 0 && (
        <div className={cn('border-t border-slate-200 pt-3 flex items-center justify-between rounded-xl bg-white px-3 py-2 border border-slate-100')}>
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Gross Margin</p>
            <p className="text-[8px] font-bold text-slate-400">at ${data.guestPrice.toFixed(2)} guest price</p>
          </div>
          <p className={cn('text-2xl font-black', marginColor)}>
            {grossMargin !== null ? pct(grossMargin) : '—'}
          </p>
        </div>
      )}
    </div>
  );
};

// ─── MAIN DIALOG ──────────────────────────────────────────────────────────────
export function AddRefreshmentDialog(props: Props) {
  // Support both inventory page shape (open/onOpenChange/onRefreshmentAdded)
  // and direct shape (isOpen/onClose/onSave)
  const isOpen    = props.open ?? props.isOpen ?? false;
  const onClose   = props.onClose ?? (() => props.onOpenChange?.(false));
  const { tenantId, eventId, initial } = props;
  const [step,        setStep]        = useState(1);
  const [data,        setData]        = useState<FormData>({ ...DEFAULT, ...initial });
  const [isSaving,    setIsSaving]    = useState(false);
  const [showRecipe,  setShowRecipe]  = useState(false);
  const [errors,      setErrors]      = useState<Record<string, string>>({});

  const upd = useCallback((patch: Partial<FormData>) => {
    setData(prev => ({ ...prev, ...patch }));
    const keys = Object.keys(patch);
    setErrors(prev => { const next = { ...prev }; keys.forEach(k => delete next[k]); return next; });
  }, []);

  const validateStep1 = () => {
    const e: Record<string, string> = {};
    if (!data.name.trim())    e.name     = 'Required';
    if (!data.category)       e.category = 'Required';
    if (data.guestPrice < 0)  e.guestPrice = 'Must be ≥ 0';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      if (props.onSave) {
        await props.onSave(data);
      } else if (props.onRefreshmentAdded) {
        // Convert FormData to InventoryItem shape for inventory page
        const id = Math.random().toString(36).slice(2);
        const ppu = data.orderQuantity > 0
          ? (data.purchasePrice * data.orderQuantity + data.deliveryCost + data.otherFees) / data.orderQuantity
          : data.purchasePrice;
        const newItem: any = {
          id,
          name:        data.name,
          type:        'refreshment',
          category:    data.category,
          description: data.description,
          imageUrl:    data.imageUrl,
          guestPrice:  data.guestPrice,
          showOnMenu:  data.showOnMenu,
          availableEvents: data.availableEvents,
          totalStock:  data.unitsOnHand,
          unitLabel:   data.unitLabel,
          divideMethod: data.divideMethod,
          unitVolumeMl: data.unitVolumeMl,
          portionVolumeMl: data.portionVolumeMl,
          portionsPerUnit: data.portionsPerUnit,
          costPerUnit: ppu,
          purchasePrice: data.purchasePrice,
          deliveryCost: data.deliveryCost,
          otherFees:   data.otherFees,
          orderQuantity: data.orderQuantity,
          recipeIngredients: data.recipeIngredients,
          batches: data.unitsOnHand > 0 ? [{
            id: `batch-${Math.random().toString(36).slice(2)}`,
            stock: data.unitsOnHand,
            costPerUnit: ppu,
            receivedDate: new Date().toISOString(),
          }] : [],
          status: 'active',
        };
        props.onRefreshmentAdded(newItem);
      }
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const portionsPerUnit = data.divideMethod === 'portions'
    ? data.portionsPerUnit
    : data.portionVolumeMl > 0 ? Math.floor(data.unitVolumeMl / data.portionVolumeMl) : 0;

  const totalOrderCost = data.purchasePrice * data.orderQuantity + data.deliveryCost + data.otherFees;
  const landedCostPerUnit = data.orderQuantity > 0 ? totalOrderCost / data.orderQuantity : 0;

  if (!isOpen) return null;


  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => onClose()} />

      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 40 }}
        className="relative z-10 w-full sm:max-w-2xl bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden max-h-[95vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400">
              Step {step} of 2
            </p>
            <h2 className="font-black text-slate-900 text-lg uppercase tracking-tight leading-none mt-0.5">
              {step === 1 ? 'Item Details' : 'Stock & Costs'}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {/* Step dots */}
            <div className="flex gap-1.5">
              {[1,2].map(s => (
                <div key={s} className={cn('rounded-full transition-all',
                  s === step ? 'w-5 h-2 bg-slate-900' : s < step ? 'w-2 h-2 bg-emerald-500' : 'w-2 h-2 bg-slate-200')} />
              ))}
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-slate-100 flex items-center justify-center">
              <X className="w-4 h-4 text-slate-400" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          <AnimatePresence mode="wait">

            {/* ── STEP 1 ── */}
            {step === 1 && (
              <motion.div key="s1" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }}
                className="p-6 space-y-5">

                <Field label="Item Name">
                  <Input value={data.name} onChange={v => upd({ name: v })} placeholder="e.g. Prosecco, Sparkling Water" />
                  {errors.name && <p className="text-[9px] font-bold text-red-500">{errors.name}</p>}
                </Field>

                <Field label="Category">
                  <select value={data.category} onChange={e => upd({ category: e.target.value })}
                    className="w-full h-11 rounded-xl border-2 border-slate-100 bg-white px-3 text-sm font-bold text-slate-800 outline-none focus:border-slate-300">
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>

                <Field label="Description">
                  <textarea value={data.description} onChange={e => upd({ description: e.target.value })}
                    placeholder="Tasting notes, origin, etc."
                    rows={3}
                    className="w-full rounded-xl border-2 border-slate-100 bg-white p-3 text-sm font-semibold text-slate-800 outline-none focus:border-slate-300 resize-none placeholder:text-slate-300"
                  />
                </Field>

                <div className="grid grid-cols-2 gap-4">
                  <Field label="Image URL">
                    <Input value={data.imageUrl} onChange={v => upd({ imageUrl: v })} placeholder="https://…" />
                  </Field>
                  <Field label="Guest Price" hint="What guests pay per serving">
                    <Input type="number" value={data.guestPrice || ''} onChange={v => upd({ guestPrice: parseFloat(v) || 0 })} prefix="$" placeholder="0.00" />
                    {errors.guestPrice && <p className="text-[9px] font-bold text-red-500">{errors.guestPrice}</p>}
                  </Field>
                </div>

                {/* Visibility toggles */}
                <div className="grid grid-cols-2 gap-3">
                  {([
                    { key: 'showOnMenu', label: 'Show on Menu', icon: Eye },
                    { key: 'availableEvents', label: 'Available at Events', icon: Package },
                  ] as { key: keyof FormData; label: string; icon: any }[]).map(({ key, label, icon: Icon }) => (
                    <button key={key} onClick={() => upd({ [key]: !(data[key] as boolean) } as any)}
                      className={cn('flex items-center gap-2 p-3 rounded-xl border-2 transition-all',
                        data[key] ? 'border-emerald-200 bg-emerald-50' : 'border-slate-100 bg-white')}>
                      <Icon className={cn('w-4 h-4 shrink-0', data[key] ? 'text-emerald-500' : 'text-slate-300')} />
                      <span className={cn('text-[9px] font-black uppercase tracking-widest', data[key] ? 'text-emerald-700' : 'text-slate-400')}>
                        {label}
                      </span>
                      <div className={cn('ml-auto w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0',
                        data[key] ? 'bg-emerald-500 border-emerald-500' : 'border-slate-200')}>
                        {data[key] && <Check className="w-2.5 h-2.5 text-white" />}
                      </div>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            {/* ── STEP 2 ── */}
            {step === 2 && (
              <motion.div key="s2" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }}
                className="p-6 space-y-6">

                {/* Units on hand — BIG */}
                <div className="text-center py-2">
                  <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400 mb-2">Units on Hand</p>
                  <div className="flex items-center justify-center gap-5">
                    <button onClick={() => upd({ unitsOnHand: Math.max(0, data.unitsOnHand - 1) })}
                      className="w-12 h-12 rounded-2xl border-2 border-slate-200 flex items-center justify-center text-2xl font-black text-slate-500 hover:border-slate-400 transition-all">−</button>
                    <div>
                      <span className="text-6xl font-black text-slate-900 leading-none">{data.unitsOnHand}</span>
                    </div>
                    <button onClick={() => upd({ unitsOnHand: data.unitsOnHand + 1 })}
                      className="w-12 h-12 rounded-2xl border-2 border-slate-200 flex items-center justify-center text-2xl font-black text-slate-500 hover:border-slate-400 transition-all">+</button>
                  </div>
                  <div className="mt-3">
                    <Field label="What's one unit called?">
                      <div className="flex gap-2 justify-center flex-wrap mt-1">
                        {UNIT_LABELS.slice(0, 6).map(u => (
                          <button key={u} onClick={() => upd({ unitLabel: u })}
                            className={cn('px-3 py-1.5 rounded-xl border-2 text-[9px] font-black uppercase tracking-widest transition-all',
                              data.unitLabel === u ? 'bg-slate-900 border-slate-900 text-white' : 'border-slate-100 text-slate-500 hover:border-slate-300')}>
                            {u}
                          </button>
                        ))}
                        <input value={UNIT_LABELS.includes(data.unitLabel) ? '' : data.unitLabel}
                          onChange={e => { if (e.target.value) upd({ unitLabel: e.target.value }); }}
                          placeholder="custom…"
                          className="w-24 h-8 rounded-xl border-2 border-slate-100 px-2 text-[9px] font-bold text-slate-600 outline-none placeholder:text-slate-300"
                        />
                      </div>
                    </Field>
                  </div>
                </div>

                {/* How a unit divides */}
                <div className="space-y-3">
                  <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400">How does one {data.unitLabel} divide?</p>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { id: 'volume',   label: 'By Volume',   sub: 'e.g. 750ml → 125ml glasses' },
                      { id: 'portions', label: 'By Portions', sub: 'e.g. 1 tray = 8 portions' },
                    ] as { id: DivideMethod; label: string; sub: string }[]).map(m => (
                      <button key={m.id} onClick={() => upd({ divideMethod: m.id })}
                        className={cn('p-3 rounded-xl border-2 text-left transition-all',
                          data.divideMethod === m.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-100 text-slate-600 hover:border-slate-200')}>
                        <p className={cn('text-[10px] font-black uppercase tracking-tight', data.divideMethod === m.id ? 'text-white' : 'text-slate-700')}>{m.label}</p>
                        <p className={cn('text-[8px] font-bold mt-0.5', data.divideMethod === m.id ? 'text-white/60' : 'text-slate-400')}>{m.sub}</p>
                      </button>
                    ))}
                  </div>

                  <AnimatePresence mode="wait">
                    {data.divideMethod === 'volume' ? (
                      <motion.div key="vol" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="grid grid-cols-2 gap-3">
                        <Field label={`Total ml per ${data.unitLabel}`}>
                          <Input type="number" value={data.unitVolumeMl || ''} onChange={v => upd({ unitVolumeMl: parseFloat(v) || 0 })} suffix="ml" />
                        </Field>
                        <Field label="ml per portion">
                          <Input type="number" value={data.portionVolumeMl || ''} onChange={v => upd({ portionVolumeMl: parseFloat(v) || 0 })} suffix="ml" />
                        </Field>
                        {portionsPerUnit > 0 && (
                          <div className="col-span-2 flex items-center gap-2 p-2 rounded-xl bg-emerald-50 border border-emerald-100">
                            <Calculator className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                            <p className="text-[9px] font-black text-emerald-700">
                              = {portionsPerUnit} portions per {data.unitLabel} · {portionsPerUnit * data.unitsOnHand} total
                            </p>
                          </div>
                        )}
                      </motion.div>
                    ) : (
                      <motion.div key="por" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                        <Field label={`Portions per ${data.unitLabel}`}>
                          <Input type="number" value={data.portionsPerUnit || ''} onChange={v => upd({ portionsPerUnit: parseInt(v) || 0 })} />
                        </Field>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* ── LANDED COST CALCULATOR ── */}
                <div className="border-2 border-slate-100 rounded-2xl overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-3 bg-slate-50 border-b border-slate-100">
                    <Truck className="w-4 h-4 text-slate-500" />
                    <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-600">Landed Cost Calculator</p>
                    <div className="ml-auto flex items-center gap-1.5">
                      <Info className="w-3 h-3 text-slate-400" />
                      <p className="text-[8px] font-bold text-slate-400">Includes delivery & fees</p>
                    </div>
                  </div>
                  <div className="p-4 space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Purchase price / unit" hint="What you paid per unit before any shipping">
                        <Input type="number" value={data.purchasePrice || ''} onChange={v => upd({ purchasePrice: parseFloat(v) || 0 })} prefix="$" placeholder="0.00" />
                      </Field>
                      <Field label="Units in this order" hint="How many units were in this delivery">
                        <Input type="number" value={data.orderQuantity || ''} onChange={v => upd({ orderQuantity: parseInt(v) || 1 })} />
                      </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Delivery / shipping" hint="Total shipping cost for this order (split across all units)">
                        <Input type="number" value={data.deliveryCost || ''} onChange={v => upd({ deliveryCost: parseFloat(v) || 0 })} prefix="$" placeholder="0.00" />
                      </Field>
                      <Field label="Other fees" hint="Tax, customs, handling, import duties, etc.">
                        <Input type="number" value={data.otherFees || ''} onChange={v => upd({ otherFees: parseFloat(v) || 0 })} prefix="$" placeholder="0.00" />
                      </Field>
                    </div>

                    {/* Breakdown */}
                    {(data.purchasePrice > 0 || data.deliveryCost > 0 || data.otherFees > 0) && (
                      <div className="bg-slate-900 rounded-xl p-3 space-y-2">
                        <p className="text-[8px] font-black uppercase tracking-[0.3em] text-slate-400">Cost Breakdown</p>
                        <div className="space-y-1.5">
                          <div className="flex justify-between text-[10px]">
                            <span className="font-bold text-slate-400">Purchase ({data.orderQuantity} × {currency(data.purchasePrice)})</span>
                            <span className="font-black text-slate-200">{currency(data.purchasePrice * data.orderQuantity)}</span>
                          </div>
                          {data.deliveryCost > 0 && (
                            <div className="flex justify-between text-[10px]">
                              <span className="font-bold text-slate-400">Delivery</span>
                              <span className="font-black text-slate-200">{currency(data.deliveryCost)}</span>
                            </div>
                          )}
                          {data.otherFees > 0 && (
                            <div className="flex justify-between text-[10px]">
                              <span className="font-bold text-slate-400">Other fees</span>
                              <span className="font-black text-slate-200">{currency(data.otherFees)}</span>
                            </div>
                          )}
                          <div className="border-t border-slate-700 pt-1.5 flex justify-between">
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-300">Total order cost</span>
                            <span className="text-[10px] font-black text-white">{currency(totalOrderCost)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[11px] font-black uppercase tracking-widest text-violet-300">Landed cost / {data.unitLabel}</span>
                            <span className="text-[11px] font-black text-violet-300">{currency(landedCostPerUnit)}</span>
                          </div>
                          {data.deliveryCost + data.otherFees > 0 && (
                            <p className="text-[8px] font-bold text-slate-500">
                              vs {currency(data.purchasePrice)} purchase price alone · +{currency(landedCostPerUnit - data.purchasePrice)} overhead
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* ── RECIPE (collapsible) ── */}
                <div className="border-2 border-slate-100 rounded-2xl overflow-hidden">
                  <button onClick={() => setShowRecipe(s => !s)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-all text-left">
                    <Calculator className="w-4 h-4 text-slate-400" />
                    <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-600 flex-1">Recipe / Ingredients</p>
                    <ChevronDown className={cn('w-4 h-4 text-slate-400 transition-transform', showRecipe && 'rotate-180')} />
                  </button>
                  <AnimatePresence>
                    {showRecipe && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden border-t border-slate-100">
                        <div className="p-4 space-y-3">
                          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                            Add ingredients used per {data.unitsOnHand > 0 ? `batch of ${portionsPerUnit} portions` : 'batch'}
                          </p>
                          {data.recipeIngredients.map((ing, i) => (
                            <div key={ing.id} className="flex items-center gap-2">
                              <input value={ing.name} onChange={e => {
                                const list = [...data.recipeIngredients];
                                list[i] = { ...ing, name: e.target.value };
                                upd({ recipeIngredients: list });
                              }} placeholder="Ingredient" className="flex-1 h-9 rounded-xl border-2 border-slate-100 px-3 text-sm font-bold text-slate-700 outline-none placeholder:text-slate-300" />
                              <div className="flex items-center h-9 rounded-xl border-2 border-slate-100 overflow-hidden">
                                <span className="px-2 text-[10px] font-black text-slate-400 border-r border-slate-100">$</span>
                                <input type="number" value={ing.cost || ''} onChange={e => {
                                  const list = [...data.recipeIngredients];
                                  list[i] = { ...ing, cost: parseFloat(e.target.value) || 0 };
                                  upd({ recipeIngredients: list });
                                }} placeholder="0.00" className="w-20 h-full px-2 text-sm font-bold text-slate-700 outline-none bg-transparent placeholder:text-slate-300" />
                              </div>
                              <button onClick={() => upd({ recipeIngredients: data.recipeIngredients.filter((_,j) => j !== i) })}
                                className="w-9 h-9 rounded-xl border-2 border-slate-100 flex items-center justify-center text-slate-400 hover:text-red-400 hover:border-red-100">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                          <button onClick={() => upd({ recipeIngredients: [...data.recipeIngredients, { id: Math.random().toString(36).slice(2), name: '', cost: 0, unit: '' }] })}
                            className="w-full h-9 rounded-xl border-2 border-dashed border-slate-200 text-[9px] font-black uppercase tracking-widest text-slate-400 hover:border-slate-400 hover:text-slate-600 flex items-center justify-center gap-1.5 transition-all">
                            <Plus className="w-3 h-3" /> Add Ingredient
                          </button>
                          {data.recipeIngredients.length > 0 && (
                            <div className="flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-100">
                              <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">Total ingredient cost</span>
                              <span className="font-black text-sm text-slate-800">
                                {currency(data.recipeIngredients.reduce((s,i) => s + (i.cost||0), 0))}
                                {portionsPerUnit > 0 && <span className="text-[9px] font-bold text-slate-400 ml-1">for {portionsPerUnit} portions</span>}
                              </span>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Live summary */}
                <LiveSummary data={data} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 flex items-center gap-3">
          {step === 2 && (
            <button onClick={() => setStep(1)}
              className="flex items-center gap-1.5 px-4 h-12 rounded-xl border-2 border-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:border-slate-300 transition-all">
              <ChevronLeft className="w-3.5 h-3.5" /> Back
            </button>
          )}
          <div className="flex-1">
            {step === 1 ? (
              <button onClick={() => { if (validateStep1()) setStep(2); }}
                className="w-full h-12 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-slate-800 transition-all">
                Stock & Costs <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button onClick={handleSave} disabled={isSaving}
                className="w-full h-12 rounded-xl bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-emerald-500 disabled:opacity-50 transition-all">
                {isSaving ? <Loader className="w-4 h-4 animate-spin" /> : <><Check className="w-4 h-4" /> Save Item</>}
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}