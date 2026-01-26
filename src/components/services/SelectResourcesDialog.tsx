

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
import { Search, Building, HardHat } from 'lucide-react';

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

  useEffect(() => {
    if (open) {
      setSelectedIds(new Set(initialSelected.map(r => r.id)));
    }
  }, [open, initialSelected]);

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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Select Required Resources</DialogTitle>
          <DialogDescription>Choose the rooms or equipment needed for this service.</DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search resources..."
              className="pl-9"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <ScrollArea className="h-72">
            <div className="space-y-4 pr-4">
              {rooms.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm flex items-center gap-2 text-muted-foreground"><Building className="w-4 h-4" /> Rooms / Stations</h4>
                  {rooms.map(resource => (
                    <div key={resource.id} className="flex items-center space-x-3 p-2 rounded-md hover:bg-muted">
                      <Checkbox
                        id={`resource-${resource.id}`}
                        checked={selectedIds.has(resource.id)}
                        onCheckedChange={() => handleToggle(resource.id)}
                      />
                      <label htmlFor={`resource-${resource.id}`} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex-1 cursor-pointer">
                        {resource.name}
                      </label>
                    </div>
                  ))}
                </div>
              )}
              {equipment.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm flex items-center gap-2 text-muted-foreground"><HardHat className="w-4 h-4" /> Equipment</h4>
                  {equipment.map(resource => (
                    <div key={resource.id} className="flex items-center space-x-3 p-2 rounded-md hover:bg-muted">
                      <Checkbox
                        id={`resource-${resource.id}`}
                        checked={selectedIds.has(resource.id)}
                        onCheckedChange={() => handleToggle(resource.id)}
                      />
                      <label htmlFor={`resource-${resource.id}`} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex-1 cursor-pointer">
                        {resource.name}
                      </label>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Add Selected ({selectedIds.size})</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

  