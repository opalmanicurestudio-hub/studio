

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
import { Search, List } from 'lucide-react';
import Image from 'next/image';

interface SelectAddOnsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (selected: Service[]) => void;
  allAddOns: Service[];
  initialSelected: Service[];
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

  useEffect(() => {
    if (open) {
      setSelectedIds(new Set(initialSelected.map(p => p.id)));
    }
  }, [open, initialSelected]);

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
    onOpenChange(false);
  };

  const filteredAddOns = allAddOns.filter(p =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Select Compatible Add-ons</DialogTitle>
          <DialogDescription>Choose which add-on services can be booked with this main service.</DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="Search add-ons..."
                    className="pl-9"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                />
            </div>
            <ScrollArea className="h-72">
                <div className="space-y-2 pr-4">
                {filteredAddOns.map(addOn => (
                    <div
                        key={addOn.id}
                        className="flex items-center space-x-3 p-2 rounded-md hover:bg-muted"
                    >
                         <Checkbox
                            id={`addon-${addOn.id}`}
                            checked={selectedIds.has(addOn.id)}
                            onCheckedChange={() => handleToggle(addOn.id)}
                        />
                         <div className='w-10 h-10 bg-muted rounded-md flex-shrink-0 flex items-center justify-center'>
                             {addOn.imageUrl ? (
                                <Image src={addOn.imageUrl} alt={addOn.name} width={40} height={40} className='rounded-md'/>
                             ) : (
                                <List className="w-5 h-5 text-muted-foreground" />
                             )}
                        </div>
                        <label
                            htmlFor={`addon-${addOn.id}`}
                            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex-1 cursor-pointer"
                        >
                            {addOn.name}
                        </label>
                    </div>
                ))}
                </div>
            </ScrollArea>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Add Selected</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
