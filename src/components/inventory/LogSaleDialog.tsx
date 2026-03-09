'use client';

import React, { useEffect } from 'react';
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
import { type InventoryItem } from '@/lib/data';
import { useForm, Controller, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useToast } from '@/hooks/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { DollarSign, Sparkles, ShoppingCart, CreditCard, Banknote, Landmark, Wallet } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { ScrollArea } from '../ui/scroll-area';
import { cn } from '@/lib/utils';

const saleSchema = z.object({
  quantity: z.coerce.number().min(1, 'Quantity must be at least 1.'),
  paymentMethod: z.string().min(1, 'Payment method is required.'),
});

type SaleFormData = z.infer<typeof saleSchema>;

interface LogSaleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: InventoryItem | null;
  onConfirm: (productId: string, quantity: number, paymentMethod: string) => { success: boolean, message: string };
}

export const LogSaleDialog: React.FC<LogSaleDialogProps> = ({
  open,
  onOpenChange,
  product,
  onConfirm,
}) => {
  const isMobile = useIsMobile();
  const methods = useForm<SaleFormData>({
    resolver: zodResolver(saleSchema),
    defaultValues: { quantity: 1, paymentMethod: 'Card' },
  });
  const { control, handleSubmit, watch, reset, formState: { errors } } = methods;
  const { toast } = useToast();

  const quantity = watch('quantity');
  const maxQuantity = product?.totalStock || 0;
  const quantityError = quantity > maxQuantity ? `Insufficient stock (${maxQuantity})` : undefined;

  useEffect(() => {
    if (open) {
      reset({ quantity: 1, paymentMethod: 'Card' });
    }
  }, [open, reset]);

  const handleFormSubmit = (data: SaleFormData) => {
    if (quantityError || !product) return;
    const result = onConfirm(product.id, data.quantity, data.paymentMethod);
    
    if (result.success) {
        toast({ title: 'Sale Logged', description: result.message });
        onOpenChange(false);
    } else {
        toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
  };

  if (!product) return null;

  const totalSale = (product.msrp || product.costPerUnit || 0) * (quantity || 0);

  const formBody = (
    <FormProvider {...methods}>
        <form id="log-sale-strategic-form" onSubmit={handleSubmit(handleFormSubmit)}>
            <div className="grid gap-10 py-4">
                <div className="space-y-3">
                    <Label htmlFor="quantity-sale" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Volume to Liquidate</Label>
                    <div className="relative">
                        <Input id="quantity-sale" type="number" {...control.register('quantity')} className="h-20 rounded-[2rem] border-4 font-black text-5xl tracking-tighter shadow-inner bg-muted/5 pr-20 focus-visible:ring-primary/20 text-center" />
                        <span className="absolute right-6 top-1/2 -translate-y-1/2 text-xs font-black uppercase text-muted-foreground opacity-40">Units</span>
                    </div>
                    {quantityError && <p className="text-[10px] font-black text-destructive uppercase ml-1 text-center">{quantityError}</p>}
                </div>

                <div className="space-y-3">
                    <Label htmlFor="payment-method-sale" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Distribution Method</Label>
                    <Controller
                        name="paymentMethod"
                        control={control}
                        render={({ field }) => (
                            <Select onValueChange={field.onChange} value={field.value}>
                                <SelectTrigger id="payment-method-sale" className="h-14 rounded-2xl border-2 shadow-inner bg-muted/5 font-bold uppercase text-xs">
                                    <SelectValue placeholder="Select Method" />
                                </SelectTrigger>
                                <SelectContent className="rounded-xl border-2 shadow-2xl">
                                    <SelectItem value="Card" className="font-bold uppercase text-[10px] tracking-widest">CREDIT / DEBIT</SelectItem>
                                    <SelectItem value="Cash" className="font-bold uppercase text-[10px] tracking-widest">CASH TENDER</SelectItem>
                                    <SelectItem value="Other" className="font-bold uppercase text-[10px] tracking-widest">OTHER PROTOCOL</SelectItem>
                                </SelectContent>
                            </Select>
                        )}
                    />
                </div>

                <div className="p-8 rounded-[2.5rem] bg-primary/5 border-4 border-primary/10 space-y-2 shadow-2xl shadow-primary/5 text-center">
                    <p className="text-[10px] font-black uppercase text-primary/60 tracking-[0.2em]">Sale Yield</p>
                    <p className="text-5xl font-black text-primary tracking-tighter font-mono">${totalSale.toFixed(2)}</p>
                </div>
            </div>
        </form>
    </FormProvider>
  );

  const DialogContainer = isMobile ? Sheet : Dialog;
  const DialogContentContainer = isMobile ? SheetContent : DialogContent;

  return (
    <DialogContainer open={open} onOpenChange={onOpenChange}>
      <DialogContentContainer className={cn("p-0 border-none bg-background flex flex-col shadow-3xl overflow-hidden", isMobile ? "h-[85dvh] rounded-t-[3rem]" : "sm:max-w-md rounded-[3.5rem] border-4")} side="bottom">
        <DialogHeader className="p-8 pb-6 border-b bg-muted/5 flex-shrink-0 text-left">
          <div className="flex items-center gap-3 mb-2">
            <ShoppingCart className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Strategic Liquidation</span>
          </div>
          <DialogTitle className="text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">Log Manual Sale</DialogTitle>
          <DialogDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">Attribute retail revenue for: <strong className="text-foreground">{product.name}</strong></DialogDescription>
        </DialogHeader>
        
        <ScrollArea className="flex-1">
            <div className="p-8">
                {formBody}
            </div>
        </ScrollArea>

        <DialogFooter className="p-8 pt-4 border-t bg-background flex-shrink-0">
          <div className="flex flex-col gap-3 w-full">
            <Button type="submit" form="log-sale-strategic-form" className="w-full h-16 rounded-[2rem] text-xl font-black uppercase shadow-2xl shadow-primary/30 active:scale-95 transition-all" disabled={!!quantityError}>Acknowledge Sale</Button>
            <Button variant="ghost" type="button" onClick={() => onOpenChange(false)} className="w-full h-10 font-black uppercase tracking-widest text-[10px] text-slate-400">Abort Terminal</Button>
          </div>
        </DialogFooter>
      </DialogContentContainer>
    </DialogContainer>
  );
};