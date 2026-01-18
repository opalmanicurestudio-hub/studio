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
import { type ConsentForm } from '@/lib/data';
import { Search, FileSignature } from 'lucide-react';

interface BrowseConsentFormsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (selected: ConsentForm[]) => void;
  allForms: ConsentForm[];
  initialSelected: ConsentForm[];
}

export const BrowseConsentFormsDialog: React.FC<BrowseConsentFormsDialogProps> = ({
  open,
  onOpenChange,
  onSelect,
  allForms,
  initialSelected,
}) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (open) {
      setSelectedIds(new Set(initialSelected.map(f => f.id)));
    }
  }, [open, initialSelected]);

  const handleToggle = (formId: string) => {
    const newSelectedIds = new Set(selectedIds);
    if (newSelectedIds.has(formId)) {
      newSelectedIds.delete(formId);
    } else {
      newSelectedIds.add(formId);
    }
    setSelectedIds(newSelectedIds);
  };

  const handleSave = () => {
    const selectedItems = allForms.filter(f => selectedIds.has(f.id));
    onSelect(selectedItems);
    onOpenChange(false);
  };

  const filteredForms = allForms.filter(f =>
    f.title.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Browse Consent Forms</DialogTitle>
          <DialogDescription>Select the forms required for this service.</DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="Search forms..."
                    className="pl-9"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                />
            </div>
            <ScrollArea className="h-72">
                <div className="space-y-2 pr-4">
                {filteredForms.map(form => (
                    <div
                        key={form.id}
                        className="flex items-center space-x-3 p-2 rounded-md hover:bg-muted"
                    >
                         <Checkbox
                            id={`form-${form.id}`}
                            checked={selectedIds.has(form.id)}
                            onCheckedChange={() => handleToggle(form.id)}
                        />
                         <div className='w-10 h-10 bg-muted rounded-md flex-shrink-0 flex items-center justify-center'>
                            <FileSignature className="w-5 h-5 text-muted-foreground" />
                        </div>
                        <label
                            htmlFor={`form-${form.id}`}
                            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex-1 cursor-pointer"
                        >
                            {form.title}
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
          <Button onClick={handleSave}>Add Selected ({selectedIds.size})</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
