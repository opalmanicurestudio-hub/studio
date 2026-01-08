
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent } from '@/components/ui/card';
import { format, isPast, parseISO } from 'date-fns';
import { type InventoryItem } from '@/lib/data';
import { Badge } from '@/components/ui/badge';
import Image from 'next/image';

interface SpoilageItem {
  productId: string;
  productName: string;
  batchId: string;
  stock: number;
  costPerUnit: number;
  expirationDate: string;
}

interface ManageSpoilageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inventory: InventoryItem[];
  onConfirm: (productId: string, batchId: string, quantity: number, reason: string) => void;
}

export const ManageSpoilageDialog: React.FC<ManageSpoilageDialogProps> = ({
  open,
  onOpenChange,
  inventory,
  onConfirm,
}) => {
  const [selectedSpoilage, setSelectedSpoilage] = useState<Set<string>>(new Set());

  const expiredItems = useMemo(() => {
    const items: SpoilageItem[] = [];
    inventory.forEach(product => {
      product.batches.forEach(batch => {
        if (batch.expirationDate && isPast(parseISO(batch.expirationDate)) && batch.stock > 0) {
          items.push({
            productId: product.id,
            productName: product.name,
            batchId: batch.id,
            stock: batch.stock,
            costPerUnit: batch.costPerUnit,
            expirationDate: batch.expirationDate,
          });
        }
      });
    });
    return items;
  }, [inventory]);

  useEffect(() => {
    if (!open) {
      setSelectedSpoilage(new Set());
    }
  }, [open]);

  const handleToggle = (batchId: string) => {
    const newSelected = new Set(selectedSpoilage);
    if (newSelected.has(batchId)) {
      newSelected.delete(batchId);
    } else {
      newSelected.add(batchId);
    }
    setSelectedSpoilage(newSelected);
  };

  const totalLoss = useMemo(() => {
    let total = 0;
    selectedSpoilage.forEach(batchId => {
      const item = expiredItems.find(i => i.batchId === batchId);
      if (item) {
        total += item.stock * item.costPerUnit;
      }
    });
    return total;
  }, [selectedSpoilage, expiredItems]);

  const handleWriteOffSelected = () => {
    selectedSpoilage.forEach(batchId => {
      const item = expiredItems.find(i => i.batchId === batchId);
      if (item) {
        onConfirm(item.productId, item.batchId, item.stock, 'Expired');
      }
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Manage Spoilage</DialogTitle>
          <DialogDescription>
            Review and write off products that have passed their expiration date.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <ScrollArea className="h-80 pr-4">
            <div className="space-y-4">
              {expiredItems.length > 0 ? (
                expiredItems.map(item => (
                  <Card key={item.batchId} className="flex items-center p-3 gap-3">
                     <Checkbox
                      id={`spoilage-${item.batchId}`}
                      checked={selectedSpoilage.has(item.batchId)}
                      onCheckedChange={() => handleToggle(item.batchId)}
                    />
                    <div className='w-10 h-10 bg-muted rounded-md flex-shrink-0'>
                        <Image src={`https://picsum.photos/seed/inv${item.productId}/100/100`} alt={item.productName} width={40} height={40} className='rounded-md'/>
                    </div>
                    <div className="flex-1">
                      <label htmlFor={`spoilage-${item.batchId}`} className="font-medium">{item.productName}</label>
                      <p className="text-sm text-muted-foreground">
                        {item.stock} units &middot; Expired: {format(parseISO(item.expirationDate), 'MMM d, yyyy')}
                      </p>
                    </div>
                    <Badge variant="destructive">Expired</Badge>
                  </Card>
                ))
              ) : (
                <div className="text-center text-muted-foreground py-16">
                  <p>No expired products with stock.</p>
                </div>
              )}
            </div>
          </ScrollArea>
           {expiredItems.length > 0 && (
                <Card className="bg-muted/50">
                    <CardContent className="p-4 flex justify-between items-center">
                        <div className="font-medium">Total Loss Selected:</div>
                        <div className="text-lg font-bold text-destructive">${totalLoss.toFixed(2)}</div>
                    </CardContent>
                </Card>
           )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleWriteOffSelected}
            disabled={selectedSpoilage.size === 0}
            variant="destructive"
          >
            Write-Off Selected ({selectedSpoilage.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
