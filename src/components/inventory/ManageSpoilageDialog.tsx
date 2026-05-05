'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { format, isPast, parseISO } from 'date-fns';
import { type InventoryItem } from '@/lib/data';
import { Badge } from '@/components/ui/badge';
import Image from 'next/image';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { ImageUpload } from '../shared/ImageUpload';
import { AlertTriangle, Package, Sparkles, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SpoilageItem = {
  productId: string;
  productName: string;
  batchId: string;
  stock: number;
  costPerUnit: number;
  expirationDate: string;
};

interface ManageSpoilageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inventory: InventoryItem[];
  onConfirm: (items: SpoilageItem[], notes?: string, imageUrl?: string) => void;
}

export const ManageSpoilageDialog: React.FC<ManageSpoilageDialogProps> = ({
  open, onOpenChange, inventory, onConfirm,
}) => {
  const isMobile = useIsMobile();
  const [selectedSpoilage, setSelectedSpoilage] = useState<Set<string>>(new Set());
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [imageUrl, setImageUrl] = useState('');

  const expiredItems = useMemo(() => {
    const items: SpoilageItem[] = [];
    inventory.forEach(product => {
      product.batches.forEach(batch => {
        if (batch.expirationDate && isPast(parseISO(batch.expirationDate)) && batch.stock > 0) {
          items.push({ productId: product.id, productName: product.name, batchId: batch.id, stock: batch.stock, costPerUnit: batch.costPerUnit, expirationDate: batch.expirationDate });
        }
      });
    });
    return items;
  }, [inventory]);

  useEffect(() => {
    if (!open) { setSelectedSpoilage(new Set()); setIsConfirmOpen(false); setNotes(''); setImageUrl(''); }
  }, [open]);

  const handleToggle = (batchId: string) => {
    const next = new Set(selectedSpoilage);
    if (next.has(batchId)) next.delete(batchId); else next.add(batchId);
    setSelectedSpoilage(next);
  };

  const totalLoss = useMemo(() => {
    let total = 0;
    selectedSpoilage.forEach(batchId => {
      const item = expiredItems.find(i => i.batchId === batchId);
      if (item) total += item.stock * item.costPerUnit;
    });
    return total;
  }, [selectedSpoilage, expiredItems]);

  const handleFinalConfirm = () => {
    onConfirm(expiredItems.filter(item => selectedSpoilage.has(item.batchId)), notes, imageUrl);
    onOpenChange(false);
  };

  const inner = (
    <>
      <div className="flex-shrink-0 text-left border-b bg-muted/5 p-6 md:p-8 md:pb-6">
        <div className="flex items-center gap-3 mb-2">
          <AlertTriangle className="w-5 h-5 text-destructive" />
          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Spoilage Reconciliation</span>
        </div>
        <h2 className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">Manage Expired Stock</h2>
        <p className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">Select expired batches to write off from the studio ledger.</p>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-6 md:p-8 space-y-3 pb-10">
          {expiredItems.length > 0 ? expiredItems.map(item => {
            const isSelected = selectedSpoilage.has(item.batchId);
            const productImage = inventory.find(p => p.id === item.productId)?.imageUrl;
            return (
              <div
                key={item.batchId}
                className={cn(
                  'flex items-center gap-4 p-4 rounded-2xl border-2 transition-all cursor-pointer',
                  isSelected ? 'border-destructive/30 bg-destructive/5 shadow-md' : 'border-border/50 bg-white hover:border-destructive/20',
                )}
                onClick={() => handleToggle(item.batchId)}
              >
                <Checkbox
                  id={`spoilage-${item.batchId}`}
                  checked={isSelected}
                  onCheckedChange={() => handleToggle(item.batchId)}
                  className="h-6 w-6 rounded-lg border-2"
                  onClick={e => e.stopPropagation()}
                />
                <div className="w-12 h-12 bg-muted rounded-xl flex-shrink-0 border-2 border-white shadow-inner overflow-hidden flex items-center justify-center">
                  {productImage ? (
                    <Image src={productImage} alt={item.productName} width={48} height={48} className="object-cover h-full w-full" />
                  ) : (
                    <Package className="w-5 h-5 text-muted-foreground opacity-40" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-black text-xs uppercase tracking-tight text-slate-900 truncate">{item.productName}</p>
                  <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">
                    {item.stock} units &middot; Expired {format(parseISO(item.expirationDate), 'MMM d, yyyy')}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <Badge variant="destructive" className="text-[8px] font-black uppercase tracking-widest animate-pulse">Void</Badge>
                  <p className="text-[10px] font-black font-mono text-destructive mt-1">${(item.stock * item.costPerUnit).toFixed(2)}</p>
                </div>
              </div>
            );
          }) : (
            <div className="text-center py-20 border-4 border-dashed rounded-[2.5rem] opacity-30 flex flex-col items-center gap-4">
              <Sparkles className="w-12 h-12" />
              <p className="text-[10px] font-black uppercase tracking-widest">No expired stock found</p>
            </div>
          )}
        </div>
      </ScrollArea>

      {expiredItems.length > 0 && (
        <div className="flex-shrink-0 mx-6 md:mx-8 mb-0 mt-0 py-4 border-t border-dashed flex justify-between items-center">
          <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Selected Loss</span>
          <span className="text-2xl font-black font-mono tracking-tighter text-destructive">${totalLoss.toFixed(2)}</span>
        </div>
      )}

      <div className="flex-shrink-0 border-t bg-background shadow-2xl p-4 md:p-6">
        <div className="flex flex-col gap-3 w-full">
          <Button
            onClick={() => selectedSpoilage.size > 0 && setIsConfirmOpen(true)}
            disabled={selectedSpoilage.size === 0}
            variant="destructive"
            className="w-full h-14 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-2xl"
          >
            Write-Off Selected ({selectedSpoilage.size}) <ArrowRight className="ml-2 w-4 h-4" />
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="w-full h-10 font-black uppercase tracking-widest text-[10px] text-slate-400">
            Cancel
          </Button>
        </div>
      </div>
    </>
  );

  return (
    <>
      {isMobile ? (
        <Sheet open={open} onOpenChange={onOpenChange}>
          <SheetContent side="bottom" className="h-[90dvh] rounded-t-[2.5rem] p-0 border-none bg-background flex flex-col overflow-hidden shadow-2xl">
            {inner}
          </SheetContent>
        </Sheet>
      ) : (
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent className="sm:max-w-lg h-[85dvh] !flex flex-col !gap-0 p-0 border-4 rounded-[2.5rem] overflow-hidden shadow-2xl">
            {inner}
          </DialogContent>
        </Dialog>
      )}

      <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <AlertDialogContent className="rounded-[2.5rem] border-4 shadow-2xl p-0 overflow-hidden">
          <AlertDialogHeader className="p-8 pb-6 border-b bg-muted/5 text-left">
            <AlertDialogTitle className="text-2xl font-black uppercase tracking-tighter text-slate-900">Confirm Write-Off</AlertDialogTitle>
            <AlertDialogDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">
              {selectedSpoilage.size} batch(es) &middot; Total loss ${totalLoss.toFixed(2)}. This permanently adjusts inventory and logs an expense.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="p-8 space-y-6">
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Audit Notes (Optional)</Label>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g., Damaged during shipment, found during cleaning." className="rounded-2xl border-2 bg-muted/5 min-h-[90px] font-medium" />
            </div>
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Photo Evidence (Optional)</Label>
              <ImageUpload onImageUploaded={setImageUrl} />
            </div>
          </div>
          <AlertDialogFooter className="p-6 pt-0 flex flex-col gap-3">
            <AlertDialogAction onClick={handleFinalConfirm} className={cn(buttonVariants({ variant: 'destructive' }), 'w-full h-14 rounded-2xl font-black uppercase tracking-widest text-[10px]')}>
              Authorize Write-Off
            </AlertDialogAction>
            <AlertDialogCancel className="w-full h-10 rounded-xl font-bold uppercase text-[10px] tracking-widest border-none text-slate-400">
              Cancel
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};