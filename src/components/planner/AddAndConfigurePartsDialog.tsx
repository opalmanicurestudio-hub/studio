'use client';

import React, { useState, useEffect, useMemo } from 'react';
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { type Service, type Staff } from '@/lib/data';
import { Search, Sparkles, Workflow, Zap, Check, X, Users, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { useIsMobile } from '@/hooks/use-mobile';
import { motion, AnimatePresence } from 'framer-motion';

interface PartConfig {
  staffId: string;
  isConcurrent: boolean;
}

interface AddAndConfigurePartsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (selected: Service[], configs: Record<string, PartConfig>) => void;
  allAddOns: Service[];
  initialSelected: Service[];
  staff: Staff[];
  defaultStaffId: string;
  /** The lead service for this appointment — shown in the lineup so staff can see the full picture, not just the add-ons being edited here. */
  leadService?: Service;
  /** Saved per-part staff assignments (appointment.checkoutState.serviceStaffOverrides) — without this, reopening the dialog silently resets every part back to the lead provider. */
  existingOverrides?: Record<string, string>;
  /** Saved concurrent flags (appointment.checkoutState.concurrentServiceIds) — same reasoning as above. */
  existingConcurrentIds?: string[];
}

// ─── Provider lineup (direction-by-provider summary) ───────────────────────────
type LaneItem = { id: string; name: string; isConcurrent: boolean; isLead?: boolean };
type ProviderLane = { staffId: string; staffMember?: Staff; items: LaneItem[] };

const ProviderLineup = ({ lanes, leadStaffId }: { lanes: ProviderLane[]; leadStaffId: string }) => {
  if (lanes.length === 0) return null;
  return (
    <div className="rounded-2xl border-2 border-indigo-100 bg-indigo-50/40 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Users className="w-3.5 h-3.5 text-indigo-600" />
        <span className="text-[9px] font-black uppercase tracking-widest text-indigo-700">Current Lineup by Provider</span>
      </div>
      <div className="grid gap-2">
        {lanes.map((lane) => {
          // Flag the one real physical contradiction: a part marked "Concurrent"
          // assigned to the same provider who's already the lead — one person
          // can't run two services on the client at the same time.
          const hasSelfConcurrencyConflict = lane.staffId === leadStaffId && lane.items.some((i) => !i.isLead && i.isConcurrent);
          return (
            <div key={lane.staffId} className="p-3 rounded-xl bg-white border border-indigo-100">
              <div className="flex items-start gap-3">
                <Avatar className="h-7 w-7 border shrink-0">
                  <AvatarImage src={lane.staffMember?.avatarUrl} className="object-cover" />
                  <AvatarFallback className="text-[9px] font-black bg-primary/10 text-primary">{(lane.staffMember?.name || 'S')[0]}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="text-[10px] font-black uppercase tracking-tight text-slate-800 truncate">
                    {lane.staffMember?.name || 'Unassigned'}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {lane.items.map((item) => (
                      <span
                        key={item.id}
                        className={cn(
                          'inline-flex items-center gap-1 px-2 py-1 rounded-full text-[8px] font-black uppercase tracking-widest border',
                          item.isLead
                            ? 'bg-primary/10 text-primary border-primary/20'
                            : item.isConcurrent
                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : 'bg-slate-50 text-slate-600 border-slate-200'
                        )}
                      >
                        {item.isLead ? <Sparkles className="w-2.5 h-2.5" /> : item.isConcurrent ? <Zap className="w-2.5 h-2.5" /> : <Workflow className="w-2.5 h-2.5" />}
                        {item.name}
                        {item.isLead ? ' · Lead' : item.isConcurrent ? ' · Concurrent' : ' · Sequential'}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              {hasSelfConcurrencyConflict && (
                <div className="flex items-start gap-1.5 mt-2.5 px-2.5 py-2 rounded-lg bg-amber-50 border border-amber-200">
                  <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-[8px] font-bold text-amber-700 uppercase tracking-tight leading-relaxed">
                    Marked concurrent with the lead service, but it's the same provider — one person can't run both at once. Assign a different provider or switch to sequential.
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const AddAndConfigurePartsDialog: React.FC<AddAndConfigurePartsDialogProps> = ({
  open,
  onOpenChange,
  onConfirm,
  allAddOns,
  initialSelected,
  staff,
  defaultStaffId,
  leadService,
  existingOverrides,
  existingConcurrentIds,
}) => {
  const isMobile = useIsMobile();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [configs, setConfigs] = useState<Record<string, PartConfig>>({});
  const [searchTerm, setSearchTerm] = useState('');

  const activeStaff = useMemo(() => (staff || []).filter(s => s.active && !s.onBreak), [staff]);

  useEffect(() => {
    if (open) {
      const initialIds = new Set((initialSelected || []).map(s => s.id));
      setSelectedIds(initialIds);

      // Seed each already-selected part's config from what was actually saved
      // (serviceStaffOverrides / concurrentServiceIds), falling back to the
      // lead provider + sequential only for parts that genuinely have no
      // saved assignment yet. Previously this always reset to the lead
      // provider on every reopen, silently discarding real handoff/concurrency
      // data the moment the dialog was opened again.
      const initialConfigs: Record<string, PartConfig> = {};
      (initialSelected || []).forEach(s => {
        initialConfigs[s.id] = {
          staffId: existingOverrides?.[s.id] || defaultStaffId,
          isConcurrent: (existingConcurrentIds || []).includes(s.id),
        };
      });
      setConfigs(initialConfigs);
    }
  }, [open, initialSelected, defaultStaffId, existingOverrides, existingConcurrentIds]);

  const handleToggle = (serviceId: string) => {
    const newSelectedIds = new Set(selectedIds);
    const newConfigs = { ...configs };

    if (newSelectedIds.has(serviceId)) {
      newSelectedIds.delete(serviceId);
      delete newConfigs[serviceId];
    } else {
      newSelectedIds.add(serviceId);
      // New parts default to the lead provider, sequential — staff can
      // reassign below, at which point the lineup panel reflects the change.
      newConfigs[serviceId] = {
        staffId: existingOverrides?.[serviceId] || defaultStaffId,
        isConcurrent: (existingConcurrentIds || []).includes(serviceId),
      };
    }
    setSelectedIds(newSelectedIds);
    setConfigs(newConfigs);
  };

  const updateConfig = (serviceId: string, updates: Partial<PartConfig>) => {
    setConfigs(prev => ({
      ...prev,
      [serviceId]: { ...prev[serviceId], ...updates }
    }));
  };

  const handleSave = () => {
    const selectedItems = allAddOns.filter(s => selectedIds.has(s.id));
    onConfirm(selectedItems, configs);
    onOpenChange(false);
  };

  const filteredAddOns = allAddOns.filter(p =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Build the per-provider lineup: lead service first, then every currently
  // selected add-on grouped under whichever provider it's configured for.
  // This is the "track service direction by provider" view — it's recomputed
  // live as staff change assignments, so it never lags behind the form.
  const providerLanes = useMemo<ProviderLane[]>(() => {
    const map = new Map<string, ProviderLane>();
    const ensure = (staffId: string): ProviderLane => {
      if (!map.has(staffId)) {
        map.set(staffId, { staffId, staffMember: (staff || []).find(s => s.id === staffId), items: [] });
      }
      return map.get(staffId)!;
    };

    if (leadService && defaultStaffId) {
      ensure(defaultStaffId).items.push({ id: leadService.id, name: leadService.name, isConcurrent: false, isLead: true });
    }

    selectedIds.forEach((id) => {
      const cfg = configs[id];
      if (!cfg?.staffId) return;
      const svc = allAddOns.find(a => a.id === id);
      if (!svc) return;
      ensure(cfg.staffId).items.push({ id: svc.id, name: svc.name, isConcurrent: cfg.isConcurrent });
    });

    return Array.from(map.values());
  }, [leadService, defaultStaffId, selectedIds, configs, allAddOns, staff]);

  const innerContent = (
    <div className="p-4 sm:p-8 space-y-6">
      <ProviderLineup lanes={providerLanes} leadStaffId={defaultStaffId} />

      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground opacity-40" />
        <Input
          placeholder="Search add-ons..."
          className="pl-12 h-14 rounded-2xl border-2 font-black uppercase text-sm tracking-tight focus-visible:ring-primary/20 bg-muted/5"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="space-y-4">
        {filteredAddOns.map(addOn => {
          const isSelected = selectedIds.has(addOn.id);
          const config = configs[addOn.id];
          const isSelfConcurrencyConflict = !!config && config.isConcurrent && config.staffId === defaultStaffId;

          return (
            <div key={addOn.id} className="space-y-3">
              <div
                className={cn(
                  "flex items-center gap-4 p-4 rounded-2xl border-2 transition-all cursor-pointer",
                  isSelected ? "border-primary bg-primary/5 shadow-md" : "border-border/50 hover:border-primary/20 bg-white"
                )}
                onClick={() => handleToggle(addOn.id)}
              >
                <Checkbox
                  id={`part-${addOn.id}`}
                  checked={isSelected}
                  onCheckedChange={() => handleToggle(addOn.id)}
                  className="h-6 w-6 rounded-full border-2"
                  onClick={(e) => e.stopPropagation()}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black uppercase tracking-tight text-slate-900 truncate text-left">
                    {addOn.name}
                  </p>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-[9px] font-black text-primary uppercase tracking-widest">${addOn.price.toFixed(2)}</span>
                    <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">{addOn.duration}m</span>
                  </div>
                </div>
                {isSelected && config && (
                  <span className={cn(
                    "shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full text-[8px] font-black uppercase tracking-widest border",
                    config.isConcurrent ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-slate-50 text-slate-600 border-slate-200"
                  )}>
                    {config.isConcurrent ? <Zap className="w-2.5 h-2.5" /> : <Workflow className="w-2.5 h-2.5" />}
                    {config.isConcurrent ? 'Concurrent' : 'Sequential'}
                  </span>
                )}
              </div>

              <AnimatePresence>
                {isSelected && config && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="p-4 sm:p-5 rounded-2xl border-2 border-dashed border-primary/20 bg-primary/[0.02] ml-10 space-y-5">
                      <div className="space-y-2 text-left">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Assigned Professional</Label>
                        <Select 
                          value={config.staffId} 
                          onValueChange={(val) => updateConfig(addOn.id, { staffId: val })}
                        >
                          <SelectTrigger className="h-11 rounded-xl border-2 bg-background font-bold text-xs uppercase tracking-tight">
                            <SelectValue placeholder="Select Pro" />
                          </SelectTrigger>
                          <SelectContent className="rounded-xl border-2 shadow-2xl">
                            {activeStaff.map(s => (
                              <SelectItem key={s.id} value={s.id} className="rounded-xl">
                                <div className="flex items-center gap-2">
                                  <div className={cn("w-2 h-2 rounded-full", s.status === 'busy' ? "bg-red-500" : "bg-green-500")} />
                                  <Avatar className="h-5 w-5 border shadow-inner">
                                    <AvatarImage src={s.avatarUrl} className="object-cover" />
                                    <AvatarFallback className="text-[8px]">{(s.name || 'S')[0]}</AvatarFallback>
                                  </Avatar>
                                  <span className="text-[10px] font-black uppercase">{s.name}</span>
                                  {s.id === defaultStaffId && (
                                    <span className="text-[7px] font-black uppercase text-primary/60 ml-1">Lead</span>
                                  )}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2 text-left">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Flow Logic</Label>
                        <RadioGroup 
                          value={config.isConcurrent ? 'concurrent' : 'sequential'} 
                          onValueChange={(v) => updateConfig(addOn.id, { isConcurrent: v === 'concurrent' })}
                          className="grid grid-cols-2 gap-2"
                        >
                          <label htmlFor={`flow-seq-${addOn.id}`} className="cursor-pointer">
                            <div className={cn(
                              "flex items-center justify-center gap-2 p-3 rounded-xl border-2 transition-all",
                              !config.isConcurrent ? "border-primary bg-primary/5 shadow-sm text-primary" : "border-border bg-background hover:bg-muted/50"
                            )}>
                              <Workflow className="w-3 h-3" />
                              <span className="text-[9px] font-black uppercase tracking-widest">Sequential</span>
                              <RadioGroupItem value="sequential" id={`flow-seq-${addOn.id}`} className="sr-only" />
                            </div>
                          </label>
                          <label htmlFor={`flow-con-${addOn.id}`} className="cursor-pointer">
                            <div className={cn(
                              "flex items-center justify-center gap-2 p-3 rounded-xl border-2 transition-all",
                              config.isConcurrent ? "border-primary bg-primary/5 shadow-sm text-primary" : "border-border bg-background hover:bg-muted/50"
                            )}>
                              <Zap className="w-3 h-3" />
                              <span className="text-[9px] font-black uppercase tracking-widest">Concurrent</span>
                              <RadioGroupItem value="concurrent" id={`flow-con-${addOn.id}`} className="sr-only" />
                            </div>
                          </label>
                        </RadioGroup>
                        {isSelfConcurrencyConflict && (
                          <div className="flex items-start gap-1.5 px-2.5 py-2 rounded-lg bg-amber-50 border border-amber-200">
                            <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0 mt-0.5" />
                            <p className="text-[8px] font-bold text-amber-700 uppercase tracking-tight leading-relaxed">
                              Same provider as the lead service — concurrent isn't possible here. Assign a different professional, or switch back to sequential.
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[95vh] p-0 border-none rounded-t-[3rem] overflow-hidden bg-background flex flex-col">
          <SheetHeader className="text-left p-6 border-b bg-muted/5 flex-shrink-0">
            <div className="flex items-center gap-3 mb-1.5">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Session Configurator</span>
            </div>
            <SheetTitle className="text-xl sm:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-tight">Add & Configure Parts</SheetTitle>
            <SheetDescription className="text-[10px] sm:text-xs font-bold uppercase tracking-widest opacity-60 mt-1">Select new parts and assign providers inline.</SheetDescription>
          </SheetHeader>
          <ScrollArea className="flex-1 min-h-0">
            {innerContent}
          </ScrollArea>
          <SheetFooter className="p-6 sm:p-8 pt-4 border-t bg-muted/5 flex-shrink-0">
            <div className="flex flex-col gap-3 w-full">
              <Button 
                onClick={handleSave} 
                disabled={selectedIds.size === 0}
                className="w-full h-14 sm:h-16 rounded-2xl text-lg sm:text-xl font-black uppercase shadow-2xl shadow-primary/20"
              >
                Apply Selection ({selectedIds.size})
              </Button>
              <Button variant="ghost" onClick={() => onOpenChange(false)} className="w-full h-10 rounded-xl font-bold uppercase text-[9px] sm:text-[10px] tracking-widest text-slate-400">Cancel</Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl p-0 border-4 rounded-[3rem] overflow-hidden shadow-3xl bg-background h-[90vh] max-h-[90vh] flex flex-col">
        <DialogHeader className="p-8 pb-4 border-b bg-muted/5 flex-shrink-0 text-left">
          <div className="flex items-center gap-3 mb-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Session Configurator</span>
          </div>
          <DialogTitle className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900">Add & Configure Parts</DialogTitle>
          <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60 mt-1">Select new parts and assign providers inline.</DialogDescription>
        </DialogHeader>
        <ScrollArea className="flex-1 min-h-0">
          {innerContent}
        </ScrollArea>
        <DialogFooter className="p-6 md:p-8 border-t bg-muted/5 flex-shrink-0">
          <div className="flex flex-col gap-3 w-full">
            <Button 
              onClick={handleSave} 
              disabled={selectedIds.size === 0}
              className="w-full h-16 rounded-2xl text-xl font-black uppercase shadow-2xl shadow-primary/20"
            >
              Apply Selection ({selectedIds.size})
            </Button>
            <Button variant="ghost" onClick={() => onOpenChange(false)} className="w-full h-12 rounded-xl font-bold uppercase text-[10px] tracking-widest text-slate-400">Cancel</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
