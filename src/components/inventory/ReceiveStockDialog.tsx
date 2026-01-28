

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
import { Label } from '@/components/ui/label';
import { ScrollArea } from '../ui/scroll-area';
import { type Order } from '@/lib/data';
import { Calendar } from '../ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { buttonVariants } from '../ui/button';

export type ReceivedItem = {
  productId: string;
  productName: string;
  quantityOrdered: number;
  quantityReceived: number;
  quantityDamaged: number;
  costPerUnit: number;
  expirationDate?: Date;
};

interface ReceiveStockDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: Order | null;
  onConfirm: (receivedItems: ReceivedItem[]) => void;
}

export const ReceiveStockDialog: React.FC<ReceiveStockDialogProps> = ({
  open,
  onOpenChange,
  order,
  onConfirm,
}) => {
  const [receivedItems, setReceivedItems] = useState<ReceivedItem[]>([]);

  useEffect(() => {
    if (order) {
      setReceivedItems(order.items.map(item => ({
        productId: item.productId,
        productName: item.productName,
        quantityOrdered: item.quantity,
        quantityReceived: item.quantity, // Default to receiving all
        quantityDamaged: 0,
        costPerUnit: item.costPerUnit,
        expirationDate: undefined,
      })));
    }
  }, [order]);

  const handleItemChange = (productId: string, field: 'quantityReceived' | 'quantityDamaged' | 'expirationDate', value: number | Date | undefined) => {
    setReceivedItems(prev => prev.map(item => {
        if (item.productId === productId) {
            const updatedItem = { ...item, [field]: value };

            if (field === 'quantityReceived' || field === 'quantityDamaged') {
              const received = field === 'quantityReceived' ? (value as number) : updatedItem.quantityReceived;
              const damaged = field === 'quantityDamaged' ? (value as number) : updatedItem.quantityDamaged;
              if (received + damaged > item.quantityOrdered) {
                if (field === 'quantityReceived') {
                  updatedItem.quantityDamaged = Math.max(0, item.quantityOrdered - received);
                } else { // field === 'quantityDamaged'
                  updatedItem.quantityReceived = Math.max(0, item.quantityOrdered - damaged);
                }
              }
            }
            return updatedItem;
        }
        return item;
    }));
  };

  const handleConfirmClick = () => {
    onConfirm(receivedItems);
    onOpenChange(false);
  };
  
  if (!order) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Receive Stock for Order #{order.id.slice(-6).toUpperCase()}</DialogTitle>
          <DialogDescription>
            Confirm the quantity of items received from {order.supplier}.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] -mx-6 px-6">
            <div className="space-y-4 py-4">
                {receivedItems.map(item => (
                    <div key={item.productId} className="p-4 border rounded-lg space-y-3">
                        <p className="font-semibold">{item.productName}</p>
                         <div className="flex justify-between items-center bg-muted/50 p-2 rounded-md">
                            <Label htmlFor={`qty-ordered-${item.productId}`} className="text-sm">Ordered</Label>
                            <Input id={`qty-ordered-${item.productId}`} value={item.quantityOrdered} disabled className="w-20 h-8 text-center" />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                             <div className="space-y-2">
                                <Label htmlFor={`qty-received-${item.productId}`}>Qty OK</Label>
                                <Input 
                                    id={`qty-received-${item.productId}`}
                                    type="number"
                                    value={item.quantityReceived}
                                    onChange={(e) => handleItemChange(item.productId, 'quantityReceived', parseInt(e.target.value) || 0)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor={`qty-damaged-${item.productId}`}>Qty Damaged</Label>
                                <Input 
                                    id={`qty-damaged-${item.productId}`}
                                    type="number"
                                    value={item.quantityDamaged}
                                    onChange={(e) => handleItemChange(item.productId, 'quantityDamaged', parseInt(e.target.value) || 0)}
                                />
                            </div>
                        </div>
                         <div className="space-y-2">
                            <Label htmlFor={`expiry-${item.productId}`}>Expiration Date (Optional)</Label>
                             <Popover>
                                <PopoverTrigger asChild>
                                    <Button id={`expiry-${item.productId}`} variant="outline" className={cn('w-full justify-start text-left font-normal', !item.expirationDate && "text-muted-foreground")}>
                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                        {item.expirationDate ? format(item.expirationDate, 'PPP') : 'No expiration'}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0">
                                    <Calendar mode="single" selected={item.expirationDate} onSelect={(date) => handleItemChange(item.productId, 'expirationDate', date)} initialFocus />
                                </PopoverContent>
                            </Popover>
                        </div>
                    </div>
                ))}
            </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleConfirmClick}>Confirm & Add to Stock</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
