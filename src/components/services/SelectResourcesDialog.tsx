
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
import { ScrollArea } from '@/components/ui/scroll-area';
import { type Resource } from '@/lib/data';
import { Search, Building, HardHat, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SelectResourcesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (selected: Resource[]) => void;
  allResources: Resource[];
  initialSelected: Resource[];
}

export const SelectResourcesDialog: React.FC<SelectResourcesDialogProps> = ({
  open,
  onOpenChange,
  onSelect,
  allResources,
  initialSelected,
}) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');

  // CRITICAL FIX: Only sync initialSelected when the dialog opens to prevent unselect-on-render bug
  useEffect(() => {
    if (open) {
      setSelectedIds(new Set(initialSelected.map(r => r.id)));
    }
  }, [open]);

  const handleToggle = (resourceId: string) => {
    const newSelectedIds = new Set(selectedIds);
    if (newSelectedIds.has(resourceId)) {
      newSelectedIds.delete(resourceId);
    } else {
      newSelectedIds.add(resourceId);
    }
    setSelectedIds(newSelectedIds);
  };

  const handleSave = () => {
    const selectedItems = allResources.filter(r => selectedIds.has(r.id));
    onSelect(selectedItems);
    onOpenChange(false);
  };

  const filteredResources = allResources.filter(r =>
    r.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const rooms = filteredResources.filter(r => r.type === 'room');
  const equipment = filteredResources.filter(r => r.type === 'equipment');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-[3rem] p-0 border-4 shadow-3xl overflow-hidden">
        <DialogHeader className="p-8 pb-4 border-b bg-muted/5 text-left">
          <DialogTitle className="text-2xl font-black uppercase tracking-tighter text-slate-900">Select Required Resources</DialogTitle>
          <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60">Choose the rooms or equipment needed for this service.</DialogDescription>
        </DialogHeader>
        <div className="p-8 space-y-6">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground opacity-40" />
            <Input
              placeholder="Search resources..."
              className="pl-12 h-14 rounded-2xl border-2 font-black uppercase text-sm tracking-tight focus-visible:ring-primary/20 bg-muted/5"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <ScrollArea className="h-80">
            <div className="space-y-6 pr-4">
              {rooms.length > 0 && (
                <div className="space-y-3">
                  <h4 className="font-black text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-2 opacity-60"><Building className="w-3 h-3" /> Rooms / Stations</h4>
                  <div className="space-y-2">
                    {rooms.map(resource => {
                        const isSelected = selectedIds.has(resource.id);
                        return (
                            <div 
                                key={resource.id} 
                                className={cn(
                                    "flex items-center gap-4 p-4 rounded-2xl border-2 transition-all cursor-pointer",
                                    isSelected ? "border-primary bg-primary/5 shadow-md" : "border-border/50 hover:border-primary/20 bg-white"
                                )}
                                onClick={() => handleToggle(resource.id)}
                            >
                                <Checkbox
                                    id={`resource-${resource.id}`}
                                    checked={isSelected}
                                    onCheckedChange={() => handleToggle(resource.id)}
                                    className="h-6 w-6 rounded-full border-2"
                                    onClick={(e) => e.stopPropagation()}
                                />
                                <span className="text-sm font-black uppercase tracking-tight flex-1 cursor-pointer">
                                    {resource.name}
                                </span>
                            </div>
                        )
                    })}
                  </div>
                </div>
              )}
              {equipment.length > 0 && (
                <div className="space-y-3 pt-4 border-t border-dashed">
                  <h4 className="font-black text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-2 opacity-60"><HardHat className="w-3 h-3" /> Equipment</h4>
                  <div className="space-y-2">
                    {equipment.map(resource => {
                        const isSelected = selectedIds.has(resource.id);
                        return (
                            <div 
                                key={resource.id} 
                                className={cn(
                                    "flex items-center gap-4 p-4 rounded-2xl border-2 transition-all cursor-pointer",
                                    isSelected ? "border-primary bg-primary/5 shadow-md" : "border-border/50 hover:border-primary/20 bg-white"
                                )}
                                onClick={() => handleToggle(resource.id)}
                            >
                                <Checkbox
                                    id={`resource-${resource.id}`}
                                    checked={isSelected}
                                    onCheckedChange={() => handleToggle(resource.id)}
                                    className="h-6 w-6 rounded-full border-2"
                                    onClick={(e) => e.stopPropagation()}
                                />
                                <span className="text-sm font-black uppercase tracking-tight flex-1 cursor-pointer">
                                    {resource.name}
                                </span>
                            </div>
                        )
                    })}
                  </div>
                </div>
              )}
              {filteredResources.length === 0 && (
                    <div className="text-center py-12 opacity-30 border-4 border-dashed rounded-[2rem]">
                        <Sparkles className="w-10 h-10 mx-auto mb-2" />
                        <p className="text-[10px] font-black uppercase tracking-widest">No Matches</p>
                    </div>
                )}
            </div>
          </ScrollArea>
        </div>
        <DialogFooter className="p-8 pt-4 border-t bg-muted/5">
          <div className="flex flex-col gap-3 w-full">
            <Button onClick={handleSave} className="w-full h-16 rounded-2xl text-xl font-black uppercase shadow-2xl shadow-primary/20">Add Selected</Button>
            <Button variant="ghost" onClick={() => onOpenChange(false)} className="w-full h-12 rounded-xl font-bold uppercase text-[10px] tracking-widest text-slate-400">Cancel</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
