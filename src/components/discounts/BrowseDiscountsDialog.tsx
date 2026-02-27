
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
import { Search, Tag, CheckCircle2, AlertCircle, Ban } from 'lucide-react';
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
    // Cart-wide discounts (no specific service IDs) are always compatible.
    if (!discount.applicableServiceIds || discount.applicableServiceIds.length === 0) {
        return true;
    }
    // If the discount is service-specific, check if any of those services are in the current cart.
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
          <DialogDescription>Select a discount code to apply. Only compatible discounts can be selected.</DialogDescription>
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
          <ScrollArea className="h-80">
            <div className="space-y-3 pr-4">
              {sortedAndFilteredDiscounts.map(discount => (
                <div
                  key={discount.id}
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-xl border transition-all",
                    discount.isCompatible 
                        ? "hover:bg-primary/5 hover:border-primary/50 bg-background border-border shadow-sm cursor-pointer" 
                        : "opacity-50 bg-muted/30 grayscale border-dashed cursor-not-allowed"
                  )}
                  onClick={() => discount.isCompatible && handleSelect(discount.code)}
                >
                  <div className={cn("p-2 rounded-lg", discount.isCompatible ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                    {discount.isCompatible ? <Tag className="w-5 h-5" /> : <Ban className="w-5 h-5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <p className="text-sm font-bold uppercase tracking-tight truncate">
                            {discount.code}
                        </p>
                        {discount.isCompatible ? (
                            <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300 text-[10px] h-4 px-1">
                                <CheckCircle2 className="w-2.5 h-2.5 mr-1" />
                                Compatible
                            </Badge>
                        ) : (
                            <Badge variant="outline" className="text-[10px] h-4 px-1 opacity-50">
                                <AlertCircle className="w-2.5 h-2.5 mr-1" />
                                Incompatible
                            </Badge>
                        )}
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate">{discount.description || 'No internal description'}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-black text-primary">
                        {discount.type === 'percentage' ? `${discount.value}%` : `$${discount.value.toFixed(2)}`}
                    </p>
                    <p className="text-[9px] uppercase font-bold text-muted-foreground">Off</p>
                  </div>
                </div>
              ))}
              {sortedAndFilteredDiscounts.length === 0 && (
                <div className="text-center py-12 space-y-2">
                    <Tag className="w-10 h-10 text-muted-foreground/30 mx-auto" />
                    <p className="text-sm text-muted-foreground">No active discounts found.</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
