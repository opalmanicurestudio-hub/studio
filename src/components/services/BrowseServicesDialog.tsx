'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { type Service } from '@/lib/data';
import { Search, Sparkles, Scissors, ArrowRight } from 'lucide-react';
import Image from 'next/image';
import { cn } from '@/lib/utils';

interface BrowseServicesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (selected: Service[]) => void;
  allServices: Service[];
  initialSelected: Service[];
}

export const BrowseServicesDialog: React.FC<BrowseServicesDialogProps> = ({
  open,
  onOpenChange,
  onSelect,
  allServices,
  initialSelected,
}) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (open) {
      setSelectedIds(new Set(initialSelected.map(s => s.id)));
    }
  }, [open, initialSelected]);

  const handleToggle = (serviceId: string) => {
    const newSelectedIds = new Set(selectedIds);
    if (newSelectedIds.has(serviceId)) {
      newSelectedIds.delete(serviceId);
    } else {
      newSelectedIds.add(serviceId);
    }
    setSelectedIds(newSelectedIds);
  };

  const handleSave = () => {
    const selectedItems = allServices.filter(s => selectedIds.has(s.id));
    onSelect(selectedItems);
    onOpenChange(false);
  };

  const filteredServices = allServices.filter(s =>
    s.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-[3rem] p-0 border-4 shadow-3xl overflow-hidden flex flex-col max-h-[90dvh]">
        <DialogHeader className="flex-shrink-0 p-8 pb-4 border-b bg-muted/5 text-left">
          <div className="flex items-center gap-3 mb-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Library Audit</span>
          </div>
          <DialogTitle className="text-2xl font-black uppercase tracking-tighter text-slate-900">Browse Services</DialogTitle>
          <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60 mt-1">Select services to include as membership perks.</DialogDescription>
        </DialogHeader>

        <div className="flex-shrink-0 px-8 pt-8 pb-4">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground opacity-40" />
            <Input
              placeholder="Search services..."
              className="pl-12 h-14 rounded-2xl border-2 font-black uppercase text-sm tracking-tight focus-visible:ring-primary/20 bg-muted/5"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-8 pb-4">
          <div className="space-y-3 pr-1">
            {filteredServices.map(service => {
              const isSelected = selectedIds.has(service.id);
              return (
                <div
                  key={service.id}
                  className={cn(
                    "flex items-center gap-4 p-4 rounded-2xl border-2 transition-all cursor-pointer",
                    isSelected ? "border-primary bg-primary/5 shadow-md" : "border-border/50 hover:border-primary/20 bg-white"
                  )}
                  onClick={() => handleToggle(service.id)}
                >
                  <Checkbox
                    id={`service-browse-${service.id}`}
                    checked={isSelected}
                    onCheckedChange={() => handleToggle(service.id)}
                    className="h-6 w-6 rounded-full border-2"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <div className="w-12 h-12 bg-muted rounded-xl flex-shrink-0 flex items-center justify-center border-2 border-white shadow-inner overflow-hidden relative">
                    {service.imageUrl ? (
                      <Image src={service.imageUrl} alt={service.name} fill className="object-cover" />
                    ) : (
                      <Scissors className="w-6 h-6 text-muted-foreground opacity-40" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-black uppercase tracking-tight text-slate-900 truncate text-left">
                      {service.name}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] font-black text-primary uppercase tracking-widest">${service.price.toFixed(2)}</span>
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">{service.duration}m</span>
                    </div>
                  </div>
                </div>
              );
            })}
            {filteredServices.length === 0 && (
              <div className="text-center py-12 opacity-30 border-4 border-dashed rounded-[2rem]">
                <Sparkles className="w-10 h-10 mx-auto mb-2" />
                <p className="text-[10px] font-black uppercase tracking-widest">No Matches</p>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="flex-shrink-0 p-8 pt-4 border-t bg-muted/5">
          <div className="flex flex-col gap-3 w-full">
            <Button onClick={handleSave} className="w-full h-16 rounded-2xl text-xl font-black uppercase shadow-2xl shadow-primary/30 group">
              Add Selected ({selectedIds.size}) <ArrowRight className="ml-2 w-5 h-5 transition-transform group-hover:translate-x-1" />
            </Button>
            <Button variant="ghost" onClick={() => onOpenChange(false)} className="w-full h-12 rounded-xl font-bold uppercase text-[10px] tracking-widest text-slate-400">Cancel</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
