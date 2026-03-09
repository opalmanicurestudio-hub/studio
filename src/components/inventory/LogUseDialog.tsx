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
import { Textarea } from '@/components/ui/textarea';
import { type InventoryItem } from '@/lib/data';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useToast } from '@/hooks/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Pipette, Sparkles, X, Activity } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

const useSchema = z.object({
  productId: z.string().min(1, 'Product selection is required.'),
  quantity: z.coerce.number().min(0.1, 'Quantity must be greater than 0.'),
  reason: z.string().optional(),
});

type UseFormData = z.infer<typeof useSchema>;

interface LogUseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: InventoryItem | null; 
  allProducts: InventoryItem[];
  onConfirm: (productId: string, quantity: number, notes: string) => { success: boolean, message: string };
  dialogType: 'product' | 'overhead';
}

export const LogUseDialog: React.FC<LogUseDialogProps> = ({
  open,
  onOpenChange,
  product,
  allProducts,
  onConfirm,
  dialogType,
}) => {
  const isMobile = useIsMobile();
  const {
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<UseFormData>({
    resolver: zodResolver(useSchema),
    defaultValues: {
      productId: '',
      quantity: 1,
    }
  });
  const { toast } = useToast();

  const selectedProductId = watch('productId');
  const selectedProduct = allProducts.find(p => p.id === selectedProductId);

  useEffect(() => {
    if (open) {
      if (dialogType === 'product' && product) {
        reset({ productId: product.id, quantity: 1, reason: '' });
      } else {
        reset({ productId: '', quantity: 1, reason: '' });
      }
    }
  }, [open, reset, dialogType, product]);

  const handleFormSubmit = (data: UseFormData) => {
    const result = onConfirm(data.productId, data.quantity, data.reason || 'Manual Use Log');
    
    if (result.success) {
        toast({
            title: 'Use Logged',
            description: result.message,
        });
        onOpenChange(false);
    } else {
        toast({
            variant: 'destructive',
            title: 'Error',
            description: result.message,
        });
    }
  };

  const unitLabel = selectedProduct?.costingMethod === 'uses' ? (selectedProduct.useUnit || 'uses') : (selectedProduct?.unit || 'units');
  const overheadItems = allProducts.filter(p => p.type === 'overhead');

  const formBody = (
    <form id="log-use-strategic-form" onSubmit={handleSubmit(handleFormSubmit)}>
        <div className="grid gap-8 py-4">
        {dialogType === 'overhead' && (
            <Controller
                name="productId"
                control={control}
                render={({ field }) => (
                    <div className="space-y-3">
                    <Label htmlFor="product-select" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Overhead Item</Label>
                    <Select onValueChange={field.onChange} value={field.value}>
                        <SelectTrigger id="product-select" className="h-14 rounded-2xl border-2 shadow-inner bg-muted/5 font-bold uppercase text-xs">
                        <SelectValue placeholder="Select an item" />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl border-2 shadow-2xl">
                        {overheadItems.map(item => (
                            <SelectItem key={item.id} value={item.id} className="font-bold uppercase text-[10px] tracking-widest">
                            {item.name} ({item.totalStock} in stock)
                            </SelectItem>
                        ))}
                        </SelectContent>
                    </Select>
                    {errors.productId && <p className="text-[10px] font-black text-destructive uppercase ml-1">{errors.productId.message}</p>}
                    </div>
                )}
            />
        )}
        <Controller
            name="quantity"
            control={control}
            render={({ field }) => (
                    <div className="space-y-3 text-left">
                    <Label htmlFor="quantity" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Quantity to Deduct</Label>
                    <div className="relative">
                            <Input id="quantity" type="number" step="0.1" {...field} className="h-16 rounded-2xl border-2 font-black text-3xl tracking-tighter shadow-inner bg-muted/5 pr-16 focus-visible:ring-primary/20" />
                            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-black uppercase text-muted-foreground opacity-40">{unitLabel}</span>
                    </div>
                    {errors.quantity && <p className="text-[10px] font-black text-destructive uppercase ml-1">{errors.quantity.message}</p>}
                </div>
            )}
        />
        <Controller
            name="reason"
            control={control}
            render={({ field }) => (
                <div className="space-y-3 text-left">
                    <Label htmlFor="reason" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Reason / Note (Optional)</Label>
                    <Textarea id="reason" placeholder="e.g., Dropped bottle, product test..." {...field} className="rounded-2xl border-2 bg-muted/5 min-h-[120px] focus-visible:ring-primary/20 font-medium" />
                </div>
            )}
        />
        </div>
    </form>
  );

  const DialogContainer = isMobile ? Sheet : Dialog;
  const DialogContentContainer = isMobile ? SheetContent : DialogContent;

  return (
    <DialogContainer open={open} onOpenChange={onOpenChange}>
      <DialogContentContainer className={cn("p-0 border-none bg-background flex flex-col shadow-3xl overflow-hidden", isMobile ? "h-[85dvh] rounded-t-[3rem]" : "sm:max-w-md")} side="bottom">
        <DialogHeader className="p-8 pb-6 border-b bg-muted/5 flex-shrink-0 text-left">
          <div className="flex items-center gap-3 mb-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Strategic Adjustment</span>
          </div>
          <DialogTitle className="text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">Log Manual Use</DialogTitle>
          <DialogDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">
            {dialogType === 'product' && product ? `Deduct stock for: ${product.name}` : 'Deduct stock for an overhead item.'}
          </DialogDescription>
        </DialogHeader>
        
        <ScrollArea className="flex-1">
            <div className="p-8">
                {formBody}
            </div>
        </ScrollArea>

        <DialogFooter className="p-8 pt-4 border-t bg-background flex-shrink-0">
          <div className="flex flex-col gap-3 w-full">
            <Button type="submit" form="log-use-strategic-form" className="w-full h-16 rounded-2xl text-lg font-black uppercase shadow-2xl shadow-primary/30">Log Consumption</Button>
            <Button variant="ghost" type="button" onClick={() => onOpenChange(false)} className="w-full h-10 font-black uppercase tracking-widest text-[10px] text-slate-400">Cancel Protocol</Button>
          </div>
        </DialogFooter>
      </DialogContentContainer>
    </DialogContainer>
  );
};