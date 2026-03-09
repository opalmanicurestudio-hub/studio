'use client';

import React, { useState, useEffect } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '../ui/scroll-area';
import { type Order } from '@/lib/data';
import { Truck, Sparkles, CheckCircle2, AlertTriangle, Calendar as CalendarIcon, PackageOpen, ArrowRight, Package, Check, XCircle } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { Badge } from '../ui/badge';

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
  const isMobile = useIsMobile();
  const [receivedItems, setReceivedItems] = useState<ReceivedItem[]>([]);

  useEffect(() => {
    if (order) {
      setReceivedItems(order.items.map(item => ({
        productId: item.productId,
        productName: item.productName,
        quantityOrdered: item.quantity,
        quantityReceived: item.quantity,
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
                if (field === 'quantityReceived') updatedItem.quantityDamaged = Math.max(0, item.quantityOrdered - received);
                else updatedItem.quantityReceived = Math.max(0, item.quantityOrdered - damaged);
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

  const innerContent = (
    <div className="space-y-8">
        {receivedItems.map(item => (
            <div key={item.productId} className="p-6 rounded-[2.5rem] border-2 bg-white shadow-xl space-y-6 text-left">
                <div className="space-y-1">
                    <p className="font-black text-lg uppercase tracking-tight text-slate-900 leading-tight">{item.productName}</p>
                    <div className="flex items-center gap-2">
                        <Badge variant="outline" className="bg-muted/50 border-none font-black text-[8px] uppercase h-5 px-2">Ordered: {item.quantityOrdered} Units</Badge>
                    </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor={`qty-ok-${item.productId}`} className="text-[10px] font-black uppercase tracking-widest text-primary ml-1">Verified OK</Label>
                        <div className="relative">
                            <Check className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary opacity-40" />
                            <Input id={`qty-ok-${item.productId}`} type="number" value={item.quantityReceived} onChange={(e) => handleItemChange(item.productId, 'quantityReceived', parseInt(e.target.value) || 0)} className="h-14 pl-12 rounded-2xl border-2 font-black text-xl shadow-inner bg-primary/5 border-primary/20 text-primary text-center" />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor={`qty-dmg-${item.productId}`} className="text-[10px] font-black uppercase tracking-widest text-destructive ml-1">Damaged</Label>
                        <div className="relative">
                            <XCircle className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-destructive opacity-40" />
                            <Input id={`qty-dmg-${item.productId}`} type="number" value={item.quantityDamaged} onChange={(e) => handleItemChange(item.productId, 'quantityDamaged', parseInt(e.target.value) || 0)} className="h-14 pl-12 rounded-2xl border-2 font-black text-xl shadow-inner bg-destructive/5 border-destructive/20 text-destructive text-center" />
                        </div>
                    </div>
                </div>

                <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Shelf Expiry (If Applicable)</Label>
                    <div className="relative">
                        <CalendarIcon className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground opacity-40" />
                        <Input
                            type="date"
                            value={item.expirationDate ? format(item.expirationDate, 'yyyy-MM-dd') : ''}
                            onChange={(e) => handleItemChange(item.productId, 'expirationDate', e.target.value ? new Date(e.target.value.replace(/-/g, '/')) : undefined)}
                            className="h-14 pl-12 rounded-2xl border-2 font-bold bg-muted/5 shadow-inner"
                        />
                    </div>
                </div>
            </div>
        ))}
    </div>
  );

  const DialogContainer = isMobile ? Sheet : Dialog;
  const DialogContentContainer = isMobile ? SheetContent : DialogContent;

  return (
    <DialogContainer open={open} onOpenChange={onOpenChange}>
      <DialogContentContainer side="right" className={cn("p-0 border-none bg-background flex flex-col shadow-3xl overflow-hidden", isMobile ? "h-[95dvh] rounded-t-[3rem]" : "sm:max-w-xl max-h-[95dvh]")}>
        <SheetHeader className={cn("flex-shrink-0 text-left border-b bg-muted/5", isMobile ? "p-6" : "p-8 pb-6")}>
          <div className="flex items-center gap-3 mb-2">
            <PackageOpen className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Logistics intake</span>
          </div>
          <SheetTitle className="text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">Receive Manifest</SheetTitle>
          <SheetDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">Verifying shipment from: {order.supplier}</SheetDescription>
        </SheetHeader>
        
        <ScrollArea className="flex-1">
            <div className={cn("pb-32", isMobile ? "p-6" : "p-8")}>
                {innerContent}
            </div>
        </ScrollArea>

        <SheetFooter className={cn("border-t bg-background flex-shrink-0 shadow-2xl", isMobile ? "p-4" : "p-6 sm:p-8 pt-4")}>
          <div className="flex flex-col gap-3 w-full">
            <Button onClick={handleConfirmClick} className="w-full h-16 rounded-[2rem] text-xl font-black uppercase shadow-2xl shadow-primary/30 active:scale-95 transition-all group">Commit to Inventory <ArrowRight className="ml-3 w-6 h-6 transition-transform group-hover:translate-x-1" /></Button>
            <Button variant="ghost" onClick={() => onOpenChange(false)} className="w-full h-10 font-black uppercase tracking-widest text-[10px] text-slate-400">Abort Intake</Button>
          </div>
        </SheetFooter>
      </DialogContentContainer>
    </DialogContainer>
  );
};