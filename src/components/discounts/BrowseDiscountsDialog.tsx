
'use client';

import React, { useState, useMemo } from 'react';
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
import { cn } from '@/lib/utils';

interface BrowseDiscountsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (code: string) => void;
  allDiscounts: Discount[];
  cartServiceIds?: string[];
}

export const BrowseDiscountsDialog: React.FC<BrowseDiscountsDialogProps> = ({
  open,
  onOpenChange,
  onSelect,
  allDiscounts,
  cartServiceIds = [],
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  const isCompatible = (discount: Discount): boolean => {
    // Cart-wide discounts are always compatible.
    if (!discount.applicableServiceIds || discount.applicableServiceIds.length === 0) {
        return true;
    }
    // If the cart has services, check for a match.
    if (cartServiceIds.length > 0) {
        return discount.applicableServiceIds.some(id => cartServiceIds.includes(id));
    }
    // A service-specific discount is not compatible if the cart has no services.
    return false;
  };

  const sortedAndFilteredDiscounts = useMemo(() => {
    return allDiscounts
        .filter(d =>
            d.isActive &&
            (d.usageLimit === 0 || d.usageCount < d.usageLimit) &&
            (d.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (d.description || '').toLowerCase().includes(searchTerm.toLowerCase()))
        )
        .map(d => ({
            ...d,
            isCompatible: isCompatible(d)
        }))
        .sort((a, b) => {
            // Sort compatible discounts to the top
            if (a.isCompatible && !b.isCompatible) return -1;
            if (!a.isCompatible && b.isCompatible) return 1;
            // Then sort by code alphabetically
            return a.code.localeCompare(b.code);
        });
  }, [allDiscounts, searchTerm, cartServiceIds]);


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
              {sortedAndFilteredDiscounts.map(discount => (
                <div
                  key={discount.id}
                  className="flex items-center space-x-3 p-3 rounded-md hover:bg-muted cursor-pointer"
                  onClick={() => handleSelect(discount.code)}
                >
                  <div className="p-2 bg-muted/50 rounded-md">
                    <Tag className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold flex items-center gap-2">
                        {discount.code}
                        {discount.isCompatible && <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/50">Compatible</Badge>}
                    </p>
                    <p className="text-xs text-muted-foreground">{discount.description}</p>
                  </div>
                  <div>
                    <Badge variant="secondary">
                        {discount.type === 'percentage' ? `${discount.value}%` : `$${discount.value.toFixed(2)}`}
                    </Badge>
                  </div>
                </div>
              ))}
              {sortedAndFilteredDiscounts.length === 0 && (
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
