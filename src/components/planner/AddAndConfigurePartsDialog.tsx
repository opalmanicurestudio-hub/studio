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
import { Search, Sparkles, Workflow, Zap, Check, X, Users } from 'lucide-react';
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
}

export const AddAndConfigurePartsDialog: React.FC<AddAndConfigurePartsDialogProps> = ({
  open,
  onOpenChange,
  onConfirm,
  allAddOns,
  initialSelected,
  staff,
  defaultStaffId,
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
      
      const initialConfigs: Record<string, PartConfig> = {};
      (initialSelected || []).forEach(s => {
        initialConfigs[s.id] = {
          staffId: defaultStaffId,
          isConcurrent: false
        };
      });
      setConfigs(initialConfigs);
    }
  }, [open, initialSelected, defaultStaffId]);

  const handleToggle = (serviceId: string) => {
    const newSelectedIds = new Set(selectedIds);
    const newConfigs = { ...configs };

    if (newSelectedIds.has(serviceId)) {
      newSelectedIds.delete(serviceId);
      delete newConfigs[serviceId];
    } else {
      newSelectedIds.add(serviceId);
      newConfigs[serviceId] = {
        staffId: defaultStaffId,
        isConcurrent: false
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

  const innerContent = (
    <div className="p-4 sm:p-8 space-y-6">
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
