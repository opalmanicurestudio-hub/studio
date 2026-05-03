'use client';

// ─── FIX ──────────────────────────────────────────────────────────────────────
// The original dialog used a completely custom portal (fixed inset-0 div) which
// bypassed Radix's portal management. On close the backdrop div remained in the
// DOM because the `isOpen` gate was set to false but the element was never
// actually unmounted cleanly (React didn't reconcile the portal correctly when
// parent state updates happened). The fix wraps in InventoryDialogShell so
// Radix handles all mounting/unmounting, focus trapping, and cleanup.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { InventoryDialogShell } from '@/components/inventory/InventoryDialogShell';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  X, Plus, Trash2, Package, DollarSign, Calculator, Check,
  AlertTriangle, Eye, ChevronDown, Loader, ChevronLeft, ChevronRight, Truck,
} from 'lucide-react';

// ─── TYPES ────────────────────────────────────────────────────────────────────
type DivideMethod = 'volume' | 'portions';
type RecipeIngredient = { id: string; name: string; cost: number; unit: string };
type FormData = {
  name: string; category: string; description: string; imageUrl: string;
  guestPrice: number; showOnMenu: boolean; availableEvents: boolean;
  unitsOnHand: number; unitLabel: string;
  divideMethod: DivideMethod;
  unitVolumeMl: number; portionVolumeMl: number; portionsPerUnit: number;
  purchasePrice: number; orderQuantity: number; deliveryCost: number; otherFees: number;
  recipeIngredients: RecipeIngredient[];
};
type Props = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onRefreshmentAdded?: (item: any) => void;
  locations?: any[];
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

const CATEGORIES  = ['Beverages', 'Wine & Spirits', 'Beer & Cider', 'Non-Alcoholic', 'Snacks', 'Appetizers', 'Desserts', 'Other'];
const UNIT_LABELS = ['bottle', 'can', 'bag', 'box', 'carton', 'container', 'jar', 'pack', 'tray', 'case', 'keg', 'barrel'];
const DEFAULT: FormData = {
  name: '', category: 'Beverages', description: '', imageUrl: '',
  guestPrice: 0, showOnMenu: true, availableEvents: true,
  unitsOnHand: 0, unitLabel: 'bottle',
  divideMethod: 'volume', unitVolumeMl: 750, portionVolumeMl: 125, portionsPerUnit: 8,
  purchasePrice: 0, orderQuantity: 1, deliveryCost: 0, otherFees: 0,
  recipeIngredients: [],
};

// ─── FIELD COMPONENT ──────────────────────────────────────────────────────────
const Field = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => (
  <div className="space-y-1.5">
    <label className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400 block">{label}</label>
    {children}
    {hint && <p className="text-[8px] font-bold text-slate-400">{hint}</p>}
  </div>
);

const TextInput = ({ value, onChange, type = 'text', placeholder, prefix, suffix, className }: {
  value: string | number; onChange: (v: string) => void; type?: string;
  placeholder?: string; prefix?: string; suffix?: string; className?: string;
}) => (
  <div className={cn('flex items-center h-11 rounded-xl border-2 border-slate-100 bg-white overflow-hidden focus-within:border-slate-300 transition-all', className)}>
    {prefix && <span className="px-3 text-sm font-black text-slate-400 border-r border-slate-100">{prefix}</span>}
    <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      className="flex-1 h-full px-3 text-sm font-bold text-slate-800 outline-none bg-transparent placeholder:text-slate-300" />
    {suffix && <span className="px-3 text-sm font-black text-slate-400 border-l border-slate-100">{suffix}</span>}
  </div>
);

// ─── LIVE SUMMARY ─────────────────────────────────────────────────────────────
const LiveSummary = ({ data }: { data: FormData }) => {
  const totalOrderCost = data.purchasePrice * data.orderQuantity + data.deliveryCost + data.otherFees;
  const landedCostPerUnit = data.orderQuantity > 0 ? totalOrderCost / data.orderQuantity : 0;
  const portionsPerUnit = data.divideMethod === 'portions'
    ? data.portionsPerUnit
    : data.portionVolumeMl > 0 ? Math.floor(data.unitVolumeMl / data.portionVolumeMl) : 0;
  const costPerPortion = portionsPerUnit > 0 ? landedCostPerUnit / portionsPerUnit : 0;
  const ingCost = data.recipeIngredients.reduce((s, i) => s + (i.cost || 0), 0) / Math.max(portionsPerUnit, 1);
  const totalCost = costPerPortion + ingCost;
  const margin = data.guestPrice > 0 ? ((data.guestPrice - totalCost) / data.guestPrice) * 100 : null;
  const marginColor = margin === null ? 'text-slate-400' : margin >= 60 ? 'text-emerald-600' : margin >= 30 ? 'text-amber-600' : 'text-red-500';

  const Row = ({ label, value, bold, color }: { label: string; value: string; bold?: boolean; color?: string }) => (
    <div className="flex items-center justify-between">
      <span className={cn('text-[9px] font-bold uppercase tracking-widest text-slate-500', bold && 'font-black text-slate-700')}>{label}</span>
      <span className={cn('text-sm font-black text-slate-800', bold && 'text-base', color)}>{value}</span>
    </div>
  );

  return (
    <div className="bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 space-y-3">
      <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400">Live Summary</p>
      <Row label="Units on hand"       value={String(data.unitsOnHand || 0)} />
      {portionsPerUnit > 0 && <Row label={`Portions / ${data.unitLabel}`} value={String(portionsPerUnit)} />}
      <Row label="Total portions"      value={String(portionsPerUnit * data.unitsOnHand || 0)} />
      <div className="border-t border-slate-200 pt-3 space-y-2">
        <Row label="Landed cost / unit" value={currency(landedCostPerUnit)} bold />
        <Row label="Cost per portion"  value={currency(costPerPortion)} />
        <Row label="Total stock value" value={currency(landedCostPerUnit * data.unitsOnHand)} />
      </div>
      {data.guestPrice > 0 && (
        <div className="border-t border-slate-200 pt-3 flex items-center justify-between rounded-xl bg-white px-3 py-2 border border-slate-100">
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Gross Margin</p>
            <p className="text-[8px] font-bold text-slate-400">at {currency(data.guestPrice)} guest price</p>
          </div>
          <p className={cn('text-2xl font-black', marginColor)}>{margin !== null ? pct(margin) : '—'}</p>
        </div>
      )}
    </div>
  );
};

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export function AddRefreshmentDialog(props: Props) {
  // Support both prop shapes
  const isOpen  = props.open ?? props.isOpen ?? false;
  const onClose = props.onClose ?? (() => props.onOpenChange?.(false));

  const [step,       setStep]       = useState(1);
  const [data,       setData]       = useState<FormData>({ ...DEFAULT, ...props.initial });
  const [isSaving,   setIsSaving]   = useState(false);
  const [showRecipe, setShowRecipe] = useState(false);
  const [errors,     setErrors]     = useState<Record<string, string>>({});

  // Reset when reopened
  useEffect(() => {
    if (isOpen) { setData({ ...DEFAULT, ...props.initial }); setStep(1); setErrors({}); setShowRecipe(false); }
  }, [isOpen]);

  const upd = useCallback((patch: Partial<FormData>) => {
    setData(prev => ({ ...prev, ...patch }));
    setErrors(prev => { const next = { ...prev }; Object.keys(patch).forEach(k => delete next[k]); return next; });
  }, []);

  const validateStep1 = () => {
    const e: Record<string, string> = {};
    if (!data.name.trim()) e.name = 'Required';
    if (!data.category)    e.category = 'Required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      if (props.onSave) {
        await props.onSave(data);
      } else if (props.onRefreshmentAdded) {
        const id  = Math.random().toString(36).slice(2);
        const ppu = data.orderQuantity > 0
          ? (data.purchasePrice * data.orderQuantity + data.deliveryCost + data.otherFees) / data.orderQuantity
          : data.purchasePrice;
        props.onRefreshmentAdded({
          id, name: data.name, type: 'refreshment', category: data.category,
          description: data.description, imageUrl: data.imageUrl,
          guestPrice: data.guestPrice, showOnMenu: data.showOnMenu, availableEvents: data.availableEvents,
          totalStock: data.unitsOnHand, unitLabel: data.unitLabel, divideMethod: data.divideMethod,
          unitVolumeMl: data.unitVolumeMl, portionVolumeMl: data.portionVolumeMl,
          portionsPerUnit: data.portionsPerUnit, costPerUnit: ppu,
          purchasePrice: data.purchasePrice, deliveryCost: data.deliveryCost,
          otherFees: data.otherFees, orderQuantity: data.orderQuantity,
          recipeIngredients: data.recipeIngredients,
          batches: data.unitsOnHand > 0 ? [{ id: `batch-${Math.random().toString(36).slice(2)}`, stock: data.unitsOnHand, costPerUnit: ppu, receivedDate: new Date().toISOString() }] : [],
          status: 'active',
        });
      }
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const portionsPerUnit = data.divideMethod === 'portions'
    ? data.portionsPerUnit
    : data.portionVolumeMl > 0 ? Math.floor(data.unitVolumeMl / data.portionVolumeMl) : 0;
  const totalOrderCost    = data.purchasePrice * data.orderQuantity + data.deliveryCost + data.otherFees;
  const landedCostPerUnit = data.orderQuantity > 0 ? totalOrderCost / data.orderQuantity : 0;

  // ── Inner content — rendered inside the shell's container ──────────────────
  const content = (
    <div className="flex flex-col flex-1 min-h-0">

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400">Step {step} of 2</p>
          <h2 className="font-black text-slate-900 text-lg uppercase tracking-tight leading-none mt-0.5">
            {step === 1 ? 'Item Details' : 'Stock & Costs'}
          </h2>
        </div>
        {/* Step dots */}
        <div className="flex gap-1.5">
          {[1, 2].map(s => (
            <div key={s} className={cn('rounded-full transition-all',
              s === step ? 'w-5 h-2 bg-slate-900' : s < step ? 'w-2 h-2 bg-emerald-500' : 'w-2 h-2 bg-slate-200')} />
          ))}
        </div>
      </div>

      {/* Scrollable body */}
      <ScrollArea className="flex-1 min-h-0">
        <AnimatePresence mode="wait">

          {step === 1 && (
            <motion.div key="s1" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }}
              className="p-6 space-y-5">
              <Field label="Item Name">
                <TextInput value={data.name} onChange={v => upd({ name: v })} placeholder="e.g. Prosecco, Sparkling Water" />
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
                  placeholder="Tasting notes, origin, etc." rows={3}
                  className="w-full rounded-xl border-2 border-slate-100 bg-white p-3 text-sm font-semibold text-slate-800 outline-none focus:border-slate-300 resize-none placeholder:text-slate-300" />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Image URL"><TextInput value={data.imageUrl} onChange={v => upd({ imageUrl: v })} placeholder="https://…" /></Field>
                <Field label="Guest Price" hint="Per serving">
                  <TextInput type="number" value={data.guestPrice || ''} onChange={v => upd({ guestPrice: parseFloat(v) || 0 })} prefix="$" placeholder="0.00" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {([
                  { key: 'showOnMenu', label: 'Show on Menu', icon: Eye },
                  { key: 'availableEvents', label: 'Events', icon: Package },
                ] as { key: keyof FormData; label: string; icon: any }[]).map(({ key, label, icon: Icon }) => (
                  <button key={key} onClick={() => upd({ [key]: !(data[key] as boolean) } as any)}
                    className={cn('flex items-center gap-2 p-3 rounded-xl border-2 transition-all',
                      data[key] ? 'border-emerald-200 bg-emerald-50' : 'border-slate-100 bg-white')}>
                    <Icon className={cn('w-4 h-4 shrink-0', data[key] ? 'text-emerald-500' : 'text-slate-300')} />
                    <span className={cn('text-[9px] font-black uppercase tracking-widest', data[key] ? 'text-emerald-700' : 'text-slate-400')}>{label}</span>
                    <div className={cn('ml-auto w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0',
                      data[key] ? 'bg-emerald-500 border-emerald-500' : 'border-slate-200')}>
                      {data[key] && <Check className="w-2.5 h-2.5 text-white" />}
                    </div>
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div key="s2" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }}
              className="p-6 space-y-6">

              {/* Units on hand */}
              <div className="text-center py-2">
                <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400 mb-2">Units on Hand</p>
                <div className="flex items-center justify-center gap-5">
                  <button onClick={() => upd({ unitsOnHand: Math.max(0, data.unitsOnHand - 1) })}
                    className="w-12 h-12 rounded-2xl border-2 border-slate-200 text-2xl font-black text-slate-500 hover:border-slate-400 transition-all">−</button>
                  <span className="text-6xl font-black text-slate-900 leading-none">{data.unitsOnHand}</span>
                  <button onClick={() => upd({ unitsOnHand: data.unitsOnHand + 1 })}
                    className="w-12 h-12 rounded-2xl border-2 border-slate-200 text-2xl font-black text-slate-500 hover:border-slate-400 transition-all">+</button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 justify-center">
                  {UNIT_LABELS.slice(0, 6).map(u => (
                    <button key={u} onClick={() => upd({ unitLabel: u })}
                      className={cn('px-3 py-1.5 rounded-xl border-2 text-[9px] font-black uppercase tracking-widest transition-all',
                        data.unitLabel === u ? 'bg-slate-900 border-slate-900 text-white' : 'border-slate-100 text-slate-500 hover:border-slate-300')}>
                      {u}
                    </button>
                  ))}
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
                        data.divideMethod === m.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-100 text-slate-600')}>
                      <p className={cn('text-[10px] font-black uppercase tracking-tight', data.divideMethod === m.id ? 'text-white' : 'text-slate-700')}>{m.label}</p>
                      <p className={cn('text-[8px] font-bold mt-0.5', data.divideMethod === m.id ? 'text-white/60' : 'text-slate-400')}>{m.sub}</p>
                    </button>
                  ))}
                </div>
                {data.divideMethod === 'volume' ? (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={`Total ml per ${data.unitLabel}`}><TextInput type="number" value={data.unitVolumeMl || ''} onChange={v => upd({ unitVolumeMl: parseFloat(v) || 0 })} suffix="ml" /></Field>
                    <Field label="ml per portion"><TextInput type="number" value={data.portionVolumeMl || ''} onChange={v => upd({ portionVolumeMl: parseFloat(v) || 0 })} suffix="ml" /></Field>
                    {portionsPerUnit > 0 && (
                      <div className="col-span-2 flex items-center gap-2 p-2 rounded-xl bg-emerald-50 border border-emerald-100">
                        <Calculator className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <p className="text-[9px] font-black text-emerald-700">= {portionsPerUnit} portions per {data.unitLabel} · {portionsPerUnit * data.unitsOnHand} total</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <Field label={`Portions per ${data.unitLabel}`}>
                    <TextInput type="number" value={data.portionsPerUnit || ''} onChange={v => upd({ portionsPerUnit: parseInt(v) || 0 })} />
                  </Field>
                )}
              </div>

              {/* Landed cost */}
              <div className="border-2 border-slate-100 rounded-2xl overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 bg-slate-50 border-b border-slate-100">
                  <Truck className="w-4 h-4 text-slate-500" />
                  <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-600">Landed Cost Calculator</p>
                </div>
                <div className="p-4 space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Purchase price / unit"><TextInput type="number" value={data.purchasePrice || ''} onChange={v => upd({ purchasePrice: parseFloat(v) || 0 })} prefix="$" placeholder="0.00" /></Field>
                    <Field label="Units in this order"><TextInput type="number" value={data.orderQuantity || ''} onChange={v => upd({ orderQuantity: parseInt(v) || 1 })} /></Field>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Delivery / shipping"><TextInput type="number" value={data.deliveryCost || ''} onChange={v => upd({ deliveryCost: parseFloat(v) || 0 })} prefix="$" placeholder="0.00" /></Field>
                    <Field label="Other fees"><TextInput type="number" value={data.otherFees || ''} onChange={v => upd({ otherFees: parseFloat(v) || 0 })} prefix="$" placeholder="0.00" /></Field>
                  </div>
                  {(data.purchasePrice > 0 || data.deliveryCost > 0) && (
                    <div className="bg-slate-900 rounded-xl p-3 space-y-2">
                      <div className="flex justify-between text-[10px]">
                        <span className="font-bold text-slate-400">Total order cost</span>
                        <span className="font-black text-slate-200">{currency(totalOrderCost)}</span>
                      </div>
                      <div className="flex justify-between border-t border-slate-700 pt-1.5">
                        <span className="text-[11px] font-black uppercase tracking-widest text-violet-300">Landed / {data.unitLabel}</span>
                        <span className="text-[11px] font-black text-violet-300">{currency(landedCostPerUnit)}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Recipe (collapsible) */}
              <div className="border-2 border-slate-100 rounded-2xl overflow-hidden">
                <button onClick={() => setShowRecipe(s => !s)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-all text-left">
                  <Calculator className="w-4 h-4 text-slate-400" />
                  <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-600 flex-1">Recipe / Ingredients</p>
                  <ChevronDown className={cn('w-4 h-4 text-slate-400 transition-transform', showRecipe && 'rotate-180')} />
                </button>
                <AnimatePresence>
                  {showRecipe && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-t border-slate-100">
                      <div className="p-4 space-y-3">
                        {data.recipeIngredients.map((ing, i) => (
                          <div key={ing.id} className="flex items-center gap-2">
                            <input value={ing.name} onChange={e => { const list = [...data.recipeIngredients]; list[i] = { ...ing, name: e.target.value }; upd({ recipeIngredients: list }); }} placeholder="Ingredient" className="flex-1 h-9 rounded-xl border-2 border-slate-100 px-3 text-sm font-bold text-slate-700 outline-none" />
                            <div className="flex items-center h-9 rounded-xl border-2 border-slate-100 overflow-hidden">
                              <span className="px-2 text-[10px] font-black text-slate-400 border-r border-slate-100">$</span>
                              <input type="number" value={ing.cost || ''} onChange={e => { const list = [...data.recipeIngredients]; list[i] = { ...ing, cost: parseFloat(e.target.value) || 0 }; upd({ recipeIngredients: list }); }} placeholder="0.00" className="w-20 h-full px-2 text-sm font-bold outline-none bg-transparent" />
                            </div>
                            <button onClick={() => upd({ recipeIngredients: data.recipeIngredients.filter((_, j) => j !== i) })} className="w-9 h-9 rounded-xl border-2 border-slate-100 flex items-center justify-center text-slate-400 hover:text-red-400">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                        <button onClick={() => upd({ recipeIngredients: [...data.recipeIngredients, { id: Math.random().toString(36).slice(2), name: '', cost: 0, unit: '' }] })}
                          className="w-full h-9 rounded-xl border-2 border-dashed border-slate-200 text-[9px] font-black uppercase tracking-widest text-slate-400 hover:border-slate-400 flex items-center justify-center gap-1.5 transition-all">
                          <Plus className="w-3 h-3" /> Add Ingredient
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <LiveSummary data={data} />
            </motion.div>
          )}
        </AnimatePresence>
      </ScrollArea>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-slate-100 flex items-center gap-3 flex-shrink-0">
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
    </div>
  );

  return (
    <InventoryDialogShell
      open={isOpen}
      onOpenChange={v => { if (!v) onClose(); }}
      maxWidth="sm:max-w-2xl"
    >
      {content}
    </InventoryDialogShell>
  );
}