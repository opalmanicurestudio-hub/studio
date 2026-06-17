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
import { type InventoryItem } from '@/lib/data';
import { Search } from 'lucide-react';
import Image from 'next/image';
interface SelectEquipmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (selected: InventoryItem[]) => void;
  allEquipment: InventoryItem[];
  initialSelected: InventoryItem[];
}
export const SelectEquipmentDialog: React.FC<SelectEquipmentDialogProps> = ({
  open,
  onOpenChange,
  onSelect,
  allEquipment,
  initialSelected,
}) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(initialSelected.map(e => e.id)));
  const [searchTerm, setSearchTerm] = useState('');
  useEffect(() => {
    if (open) {
      setSelectedIds(new Set(initialSelected.map(e => e.id)));
    }
  }, [open, initialSelected]);
  const handleToggle = (equipmentId: string) => {
    const newSelectedIds = new Set(selectedIds);
    if (newSelectedIds.has(equipmentId)) {
      newSelectedIds.delete(equipmentId);
    } else {
      newSelectedIds.add(equipmentId);
    }
    setSelectedIds(newSelectedIds);
  };
  const handleSave = () => {
    const selectedItems = allEquipment.filter(e => selectedIds.has(e.id));
    onSelect(selectedItems);
    // FIX: this was missing — dialog never closed after saving
    onOpenChange(false);
  };
  // FIX: guard against equipment with a missing/undefined name —
  // this filter ran unconditionally, crashing on mount if any
  // inventory document lacked a `name` field.
  const filteredEquipment = (allEquipment || []).filter(e =>
    (e.name || '').toLowerCase().includes(searchTerm.toLowerCase())
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Select Equipment</DialogTitle>
          <DialogDescription>Choose the equipment used in this service.</DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="Search equipment..."
                    className="pl-9"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                />
            </div>
            <ScrollArea className="h-72">
                <div className="space-y-2 pr-4">
                {filteredEquipment.map(item => (
                    <div
                        key={item.id}
                        className="flex items-center space-x-3 p-2 rounded-md hover:bg-muted"
                    >
                         <Checkbox
                            id={`equipment-${item.id}`}
                            checked={selectedIds.has(item.id)}
                            onCheckedChange={() => handleToggle(item.id)}
                        />
                         <div className='w-10 h-10 bg-muted rounded-md flex-shrink-0'>
                            <Image src={`https://picsum.photos/seed/inv${item.id}/100/100`} alt={item.name || 'Equipment'} width={40} height={40} className='rounded-md'/>
                        </div>
                        <label
                            htmlFor={`equipment-${item.id}`}
                            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex-1 cursor-pointer"
                        >
                            {item.name || 'Untitled equipment'}
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
