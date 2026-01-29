
'use client';

import React, { useState } from 'react';
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
import { ScrollArea } from '@/components/ui/scroll-area';
import { type Discount } from '@/lib/data';
import { Search, Tag } from 'lucide-react';
import { Badge } from '../ui/badge';

interface BrowseDiscountsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (code: string) => void;
  allDiscounts: Discount[];
}

export const BrowseDiscountsDialog: React.FC<BrowseDiscountsDialogProps> = ({
  open,
  onOpenChange,
  onSelect,
  allDiscounts,
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredDiscounts = allDiscounts.filter(d =>
    d.isActive &&
    (d.usageLimit === 0 || d.usageCount < d.usageLimit) &&
    (d.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (d.description || '').toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const handleSelect = (code: string) => {
    onSelect(code);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Browse Active Discounts</DialogTitle>
          <DialogDescription>Select a discount code to apply to the sale.</DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by code or description..."
              className="pl-9"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <ScrollArea className="h-72">
            <div className="space-y-2 pr-4">
              {filteredDiscounts.map(discount => (
                <div
                  key={discount.id}
                  className="flex items-center space-x-3 p-3 rounded-md hover:bg-muted cursor-pointer"
                  onClick={() => handleSelect(discount.code)}
                >
                  <div className="p-2 bg-muted/50 rounded-md">
                    <Tag className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold">{discount.code}</p>
                    <p className="text-xs text-muted-foreground">{discount.description}</p>
                  </div>
                  <div>
                    <Badge variant="secondary">
                        {discount.type === 'percentage' ? `${discount.value}%` : `$${discount.value.toFixed(2)}`}
                    </Badge>
                  </div>
                </div>
              ))}
              {filteredDiscounts.length === 0 && (
                <p className="text-center text-sm text-muted-foreground pt-10">No active discounts found.</p>
              )}
            </div>
          </ScrollArea>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
