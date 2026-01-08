
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(initialSelected.map(p => p.id)));
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
  };

  const filteredProducts = allProducts.filter(p =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Browse Products</DialogTitle>
          <DialogDescription>Select products to add to the service formula.</DialogDescription>
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
                {filteredProducts.map(product => (
                    <div
                        key={product.id}
                        className="flex items-center space-x-3 p-2 rounded-md hover:bg-muted"
                    >
                         <Checkbox
                            id={`product-${product.id}`}
                            checked={selectedIds.has(product.id)}
                            onCheckedChange={() => handleToggle(product.id)}
                        />
                         <div className='w-10 h-10 bg-muted rounded-md flex-shrink-0'>
                            <Image src={`https://picsum.photos/seed/inv${product.id}/100/100`} alt={product.name} width={40} height={40} className='rounded-md'/>
                        </div>
                        <label
                            htmlFor={`product-${product.id}`}
                            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex-1 cursor-pointer"
                        >
                            {product.name}
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

    