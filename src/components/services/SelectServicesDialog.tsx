

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

interface SelectServicesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (selected: Service[]) => void;
  allServices: Service[];
  initialSelected: Service[];
}

export const SelectServicesDialog: React.FC<SelectServicesDialogProps> = ({
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
      setSelectedIds(new Set(initialSelected.map(p => p.id)));
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
    const selectedItems = allServices.filter(p => selectedIds.has(p.id));
    onSelect(selectedItems);
    onOpenChange(false);
  };

  const filteredServices = allServices.filter(p =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Select Services</DialogTitle>
          <DialogDescription>Choose the services this staff member can perform.</DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="Search services..."
                    className="pl-9"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                />
            </div>
            <ScrollArea className="h-72">
                <div className="space-y-2 pr-4">
                {filteredServices.map(service => (
                    <div
                        key={service.id}
                        className="flex items-center space-x-3 p-2 rounded-md hover:bg-muted"
                    >
                         <Checkbox
                            id={`service-${service.id}`}
                            checked={selectedIds.has(service.id)}
                            onCheckedChange={() => handleToggle(service.id)}
                        />
                         <div className='w-10 h-10 bg-muted rounded-md flex-shrink-0 flex items-center justify-center'>
                             {service.imageUrl ? (
                                <Image src={service.imageUrl} alt={service.name} width={40} height={40} className='rounded-md'/>
                             ) : (
                                <List className="w-5 h-5 text-muted-foreground" />
                             )}
                        </div>
                        <label
                            htmlFor={`service-${service.id}`}
                            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex-1 cursor-pointer"
                        >
                            {service.name}
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
          <Button onClick={handleSave}>Select Services ({selectedIds.size})</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
