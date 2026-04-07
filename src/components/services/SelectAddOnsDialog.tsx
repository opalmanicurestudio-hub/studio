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
import { type Service } from '@/lib/data';
import { Search, List, Sparkles } from 'lucide-react';
import Image from 'next/image';
import { cn } from '@/lib/utils';

interface SelectAddOnsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (selected: Service[]) => void;
  allAddOns: Service[];
  initialSelected: Service[];
  staff?: any[];
  defaultStaffId?: string;
}

export const SelectAddOnsDialog: React.FC<SelectAddOnsDialogProps> = ({
  open,
  onOpenChange,
  onSelect,
  allAddOns,
  initialSelected,
}) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');

  // Only sync initialSelected when the dialog opens
  useEffect(() => {
    if (open) {
      setSelectedIds(new Set(initialSelected.map(p => p.id)));
      setSearchTerm('');
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggle = (addOnId: string) => {
    const newSelectedIds = new Set(selectedIds);
    if (newSelectedIds.has(addOnId)) {
      newSelectedIds.delete(addOnId);
    } else {
      newSelectedIds.add(addOnId);
    }
    setSelectedIds(newSelectedIds);
  };

  const handleSave = () => {
    const selectedItems = allAddOns.filter(p => selectedIds.has(p.id));
    onSelect(selectedItems);
    // FIX: Close this dialog only — do NOT call onOpenChange here.
    // The parent (AddServiceDialog) was also closing because Dialog's
    // onOpenChange was bubbling up through the DOM when this dialog closed.
    // Instead we call onOpenChange(false) explicitly only on this dialog
    // and stop any further propagation by letting onSelect handle state.
    onOpenChange(false);
  };

  const filteredAddOns = allAddOns.filter(p =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    // FIX: modal={true} and stopPropagation on the content prevents the
    // close event from bubbling to parent dialogs/sheets
    <Dialog
      open={open}
      onOpenChange={(val) => {
        // Only propagate close — never auto-close the parent
        if (!val) onOpenChange(false);
      }}
      modal={true}
    >
      <DialogContent
        className="sm:max-w-md rounded-[3rem] p-0 border-4 shadow-3xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onPointerDownOutside={(e) => e.stopPropagation()}
        onInteractOutside={(e) => e.stopPropagation()}
      >
        <DialogHeader className="p-8 pb-4 border-b bg-muted/5 text-left">
          <DialogTitle className="text-2xl font-black uppercase tracking-tighter text-slate-900">Select Compatible Add-ons</DialogTitle>
          <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60">Choose which add-on services can be booked with this main service.</DialogDescription>
        </DialogHeader>
        <div className="p-8 space-y-6">
            <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground opacity-40" />
                <Input
                    placeholder="Search add-ons..."
                    className="pl-12 h-14 rounded-2xl border-2 font-black uppercase text-sm tracking-tight focus-visible:ring-primary/20 bg-muted/5"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                />
            </div>
            <ScrollArea className="h-80">
                <div className="space-y-3 pr-4">
                {filteredAddOns.map(addOn => {
                    const isSelected = selectedIds.has(addOn.id);
                    return (
                        <div
                            key={addOn.id}
                            className={cn(
                                "flex items-center gap-4 p-4 rounded-2xl border-2 transition-all cursor-pointer",
                                isSelected ? "border-primary bg-primary/5 shadow-md" : "border-border/50 hover:border-primary/20 bg-white"
                            )}
                            onClick={() => handleToggle(addOn.id)}
                        >
                            <Checkbox
                                id={`addon-${addOn.id}`}
                                checked={isSelected}
                                onCheckedChange={() => handleToggle(addOn.id)}
                                className="h-6 w-6 rounded-full border-2"
                                onClick={(e) => e.stopPropagation()}
                            />
                            <div className='w-12 h-12 bg-muted rounded-xl flex-shrink-0 flex items-center justify-center border-2 border-white shadow-inner'>
                                {addOn.imageUrl ? (
                                    <Image src={addOn.imageUrl} alt={addOn.name} width={48} height={48} className='rounded-lg object-cover h-full w-full'/>
                                ) : (
                                    <List className="w-6 h-6 text-muted-foreground opacity-40" />
                                )}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-black uppercase tracking-tight text-slate-900 truncate">
                                    {addOn.name}
                                </p>
                                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">
                                    {addOn.duration}m &middot; ${addOn.price.toFixed(2)}
                                </p>
                            </div>
                        </div>
                    );
                })}
                {filteredAddOns.length === 0 && (
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
            <Button type="button" onClick={handleSave} className="w-full h-16 rounded-2xl text-xl font-black uppercase shadow-2xl shadow-primary/20">Add Selected</Button>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} className="w-full h-12 rounded-xl font-bold uppercase text-[10px] tracking-widest text-slate-400">Cancel</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};