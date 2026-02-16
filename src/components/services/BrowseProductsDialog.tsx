

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
import { Search, Package } from 'lucide-react';
import Image from 'next/image';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface BrowseProductsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (selected: InventoryItem[]) => void;
  allProducts: InventoryItem[];
  initialSelected: InventoryItem[];
}

export const BrowseProductsDialog: React.FC<BrowseProductsDialogProps> = ({
  open,
  onOpenChange,
  onSelect,
  allProducts,
  initialSelected,
}) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (open) {
      setSelectedIds(new Set(initialSelected.map(p => p.id)));
    }
  }, [open, initialSelected]);

  const handleToggle = (productId: string) => {
    const newSelectedIds = new Set(selectedIds);
    if (newSelectedIds.has(productId)) {
      newSelectedIds.delete(productId);
    } else {
      newSelectedIds.add(productId);
    }
    setSelectedIds(newSelectedIds);
  };

  const handleSave = () => {
    const selectedItems = allProducts.filter(p => selectedIds.has(p.id));
    onSelect(selectedItems);
    onOpenChange(false);
  };

  const filteredProducts = allProducts.filter(p =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Browse Products</DialogTitle>
          <DialogDescription>Select products to add.</DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="Search products..."
                    className="pl-9"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                />
            </div>
            <ScrollArea className="h-72">
                <div className="space-y-2 pr-4">
                {filteredProducts.map(product => {
                    return (
                        <label
                            key={product.id}
                            htmlFor={`product-${product.id}`}
                            className="flex items-center space-x-4 p-3 rounded-lg border hover:bg-muted has-[:checked]:border-primary has-[:checked]:bg-primary/5 transition-colors cursor-pointer"
                        >
                            <Checkbox
                                id={`product-${product.id}`}
                                checked={selectedIds.has(product.id)}
                                onCheckedChange={() => handleToggle(product.id)}
                            />
                            <div className='w-10 h-10 bg-muted rounded-md flex-shrink-0 flex items-center justify-center'>
                                {product.imageUrl ? (
                                    <Image src={product.imageUrl} alt={product.name} width={40} height={40} className='rounded-md object-cover h-full w-full'/>
                                ) : (
                                    <Package className="w-5 h-5 text-muted-foreground" />
                                )}
                            </div>
                            <div className="flex-1">
                                <p className="text-sm font-medium leading-none">{product.name}</p>
                                <p className="text-xs text-muted-foreground">{product.category}</p>
                            </div>
                            <div className="text-right">
                                <p className="font-mono text-base font-bold">{product.totalStock} <span className="text-xs font-normal text-muted-foreground">full</span></p>
                                {product.costingMethod === 'size' && (product.partialContainerSize || 0) > 0 && (
                                    <p className="font-mono text-xs text-muted-foreground">
                                        + {product.partialContainerSize?.toFixed(0)}{product.unit}
                                    </p>
                                )}
                                {product.costingMethod === 'uses' && (product.partialContainerUses || 0) > 0 && (
                                    <p className="font-mono text-xs text-muted-foreground">
                                        + {product.partialContainerUses} {product.useUnit || 'uses'}
                                    </p>
                                )}
                            </div>
                        </label>
                    )
                })}
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
