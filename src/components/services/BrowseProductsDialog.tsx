'use client';

import React, { useState, useEffect } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { type InventoryItem } from '@/lib/data';
import { Search, Package, Sparkles } from 'lucide-react';
import Image from 'next/image';
import { cn } from '@/lib/utils';

interface BrowseProductsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (selected: InventoryItem[]) => void;
  allProducts: InventoryItem[];
  initialSelected: InventoryItem[];
}

export const BrowseProductsDialog: React.FC<BrowseProductsDialogProps> = ({
  open, onOpenChange, onSelect, allProducts, initialSelected,
}) => {
  const isMobile = useIsMobile();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (open) {
      setSelectedIds(new Set(initialSelected.map(p => p.id)));
      setSearchTerm('');
    }
  }, [open]);

  const handleToggle = (productId: string) => {
    const next = new Set(selectedIds);
    if (next.has(productId)) next.delete(productId);
    else next.add(productId);
    setSelectedIds(next);
  };

  const handleSave = () => {
    onSelect(allProducts.filter(p => selectedIds.has(p.id)));
    onOpenChange(false);
  };

  const filteredProducts = allProducts.filter(p =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const header = (
    <div className="flex-shrink-0 p-6 md:p-8 pb-4 border-b bg-muted/5 text-left">
      <h2 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Browse Products</h2>
      <p className="text-xs font-bold uppercase tracking-widest opacity-60 mt-1">Select inventory to add to the order.</p>
    </div>
  );

  const body = (
    <>
      <div className="flex-shrink-0 px-6 md:px-8 pt-6">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground opacity-40" />
          <Input
            placeholder="Search products..."
            className="pl-12 h-14 rounded-2xl border-2 font-black uppercase text-sm tracking-tight focus-visible:ring-primary/20 bg-muted/5"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
      </div>
      <ScrollArea className="flex-1 min-h-0 px-6 md:px-8 py-4">
        <div className="space-y-3 pr-2">
          {filteredProducts.map(product => {
            const isSelected = selectedIds.has(product.id);
            return (
              <div
                key={product.id}
                className={cn(
                  'flex items-center gap-4 p-4 rounded-2xl border-2 transition-all cursor-pointer',
                  isSelected ? 'border-primary bg-primary/5 shadow-md' : 'border-border/50 hover:border-primary/20 bg-white',
                )}
                onClick={() => handleToggle(product.id)}
              >
                <Checkbox
                  id={`product-${product.id}`}
                  checked={isSelected}
                  onCheckedChange={() => handleToggle(product.id)}
                  className="h-6 w-6 rounded-full border-2"
                  onClick={e => e.stopPropagation()}
                />
                <div className="w-12 h-12 bg-muted rounded-xl flex-shrink-0 flex items-center justify-center border-2 border-white shadow-inner overflow-hidden">
                  {product.imageUrl ? (
                    <Image src={product.imageUrl} alt={product.name} width={48} height={48} className="rounded-lg object-cover h-full w-full" />
                  ) : (
                    <Package className="w-6 h-6 text-muted-foreground opacity-40" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black uppercase tracking-tight text-slate-900 truncate">{product.name}</p>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">{product.totalStock} units in stock</p>
                </div>
              </div>
            );
          })}
          {filteredProducts.length === 0 && (
            <div className="text-center py-12 opacity-30 border-4 border-dashed rounded-[2rem]">
              <Sparkles className="w-10 h-10 mx-auto mb-2" />
              <p className="text-[10px] font-black uppercase tracking-widest">No Matches</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </>
  );

  const footer = (
    <div className="flex-shrink-0 p-6 md:p-8 pt-4 border-t bg-muted/5">
      <div className="flex flex-col gap-3 w-full">
        <Button onClick={handleSave} className="w-full h-14 rounded-2xl font-black uppercase text-sm shadow-2xl shadow-primary/20">
          Add Selected ({selectedIds.size})
        </Button>
        <Button variant="ghost" onClick={() => onOpenChange(false)} className="w-full h-10 rounded-xl font-bold uppercase text-[10px] tracking-widest text-slate-400">
          Cancel
        </Button>
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[85dvh] rounded-t-[2.5rem] p-0 border-none bg-background flex flex-col overflow-hidden shadow-2xl">
          {header}
          {body}
          {footer}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md h-[80dvh] !flex flex-col !gap-0 p-0 border-4 rounded-[2.5rem] overflow-hidden shadow-2xl">
        {header}
        {body}
        {footer}
      </DialogContent>
    </Dialog>
  );
};