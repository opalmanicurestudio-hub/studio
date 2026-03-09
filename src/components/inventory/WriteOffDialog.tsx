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
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ImageUpload } from '@/components/shared/ImageUpload';
import { type InventoryItem, type Batch } from '@/lib/data';
import { useForm, Controller, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';
import { PackageX, Sparkles, AlertTriangle, DollarSign, Loader, Camera } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '../ui/scroll-area';

const writeOffSchema = z.object({
  batchId: z.string().min(1, 'You must select a batch.'),
  quantity: z.coerce.number().min(1, 'Quantity must be at least 1.'),
  reason: z.string().min(1, 'You must select a reason.'),
  notes: z.string().optional(),
  imageUrl: z.string().optional(),
});

type WriteOffFormData = z.infer<typeof writeOffSchema>;

interface WriteOffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: InventoryItem;
  onConfirm: (productId: string, batchId: string, quantity: number, reason: string, notes?: string, imageUrl?: string) => void;
}

export const WriteOffDialog: React.FC<WriteOffDialogProps> = ({
  open,
  onOpenChange,
  product,
  onConfirm,
}) => {
  const isMobile = useIsMobile();
  const methods = useForm<WriteOffFormData>({
    resolver: zodResolver(writeOffSchema),
  });

  const { control, handleSubmit, watch, reset, formState: { errors } } = methods;

  const selectedBatchId = watch('batchId');
  const selectedBatch = product.batches.find(b => b.id === selectedBatchId);
  const quantity = watch('quantity');

  useEffect(() => {
    if (open) {
      reset({
        quantity: 1,
        reason: '',
        notes: '',
        imageUrl: ''
      });
    }
  }, [open, reset]);
  
  const maxQuantity = selectedBatch?.stock || 0;
  const quantityError = quantity > maxQuantity ? `Exceeds available stock (${maxQuantity})` : undefined;

  const handleFormSubmit = (data: WriteOffFormData) => {
    if (quantityError) return;
    onConfirm(product.id, data.batchId, data.quantity, data.reason, data.notes, data.imageUrl);
    onOpenChange(false);
  };

  const formBody = (
    <FormProvider {...methods}>
        <form id="log-loss-strategic-form" onSubmit={handleSubmit(handleFormSubmit)}>
            <div className="grid gap-8 py-4">
                <div className="space-y-3">
                    <Label htmlFor="batch-select" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Asset Batch</Label>
                    <Controller
                        name="batchId"
                        control={control}
                        render={({ field }) => (
                            <Select onValueChange={field.onChange} value={field.value}>
                                <SelectTrigger id="batch-select" className="h-14 rounded-2xl border-2 shadow-inner bg-muted/5 font-bold uppercase text-xs">
                                    <SelectValue placeholder="SELECT BATCH TO RECONCILE..." />
                                </SelectTrigger>
                                <SelectContent className="rounded-xl border-2 shadow-2xl">
                                    {product.batches.filter(b => b.stock > 0).map(batch => (
                                    <SelectItem key={batch.id} value={batch.id} className="font-bold uppercase text-[10px] tracking-widest">
                                        {batch.stock} Units &middot; Received {format(new Date(batch.receivedDate), 'MMM d, yyyy')}
                                    </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    />
                    {errors.batchId && <p className="text-[10px] font-black text-destructive uppercase ml-1">{errors.batchId.message}</p>}
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="space-y-3">
                        <Label htmlFor="quantity" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Quantity Lost</Label>
                        <div className="relative">
                            <Input id="quantity" type="number" {...control.register('quantity')} disabled={!selectedBatch} className="h-14 rounded-2xl border-2 font-black text-xl shadow-inner bg-muted/5" />
                            {selectedBatch && <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black uppercase text-muted-foreground opacity-40">Max {maxQuantity}</span>}
                        </div>
                        {quantityError && <p className="text-[10px] font-black text-destructive uppercase ml-1">{quantityError}</p>}
                    </div>
                    <div className="space-y-3">
                        <Label htmlFor="reason" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Loss Category</Label>
                        <Controller
                            name="reason"
                            control={control}
                            render={({ field }) => (
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <SelectTrigger id="reason" className="h-14 rounded-2xl border-2 font-bold uppercase text-xs shadow-inner bg-muted/5">
                                        <SelectValue placeholder="SELECT REASON..." />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-xl border-2 shadow-2xl">
                                        {['Damaged on Arrival', 'Damaged in Studio', 'Expired', 'Theft/Loss', 'Internal Use', 'Other'].map(r => (
                                            <SelectItem key={r} value={r} className="font-bold uppercase text-[10px] tracking-widest">{r.toUpperCase()}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        />
                        {errors.reason && <p className="text-[10px] font-black text-destructive uppercase ml-1">{errors.reason.message}</p>}
                    </div>
                </div>

                <div className="space-y-3">
                    <Label htmlFor="notes" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Audit Notes</Label>
                    <Textarea id="notes" placeholder="Describe the event for the studio ledger..." {...control.register('notes')} className="rounded-[2rem] border-2 bg-muted/5 min-h-[100px] focus-visible:ring-primary/20 font-medium" />
                </div>

                <div className="space-y-3">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1 flex items-center gap-2">
                        <Camera className="w-3.5 h-3.5 opacity-40" />
                        Photo Evidence
                    </Label>
                    <Controller
                        name="imageUrl"
                        control={control}
                        render={({ field }) => (
                            <ImageUpload onImageUploaded={field.onChange} />
                        )}
                    />
                </div>
            </div>
        </form>
    </FormProvider>
  );

  const DialogContainer = isMobile ? Sheet : Dialog;
  const DialogContentContainer = isMobile ? SheetContent : DialogContent;

  return (
    <DialogContainer open={open} onOpenChange={onOpenChange}>
      <DialogContentContainer className={cn("p-0 border-none bg-background flex flex-col shadow-3xl overflow-hidden", isMobile ? "h-[92dvh] rounded-t-[3rem]" : "sm:max-w-xl rounded-[3.5rem] border-4")} side="bottom">
        <DialogHeader className="p-8 pb-6 border-b bg-muted/5 flex-shrink-0 text-left">
          <div className="flex items-center gap-3 mb-2">
            <PackageX className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Strategic Adjustment</span>
          </div>
          <DialogTitle className="text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">Log Loss Entry</DialogTitle>
          <DialogDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">
            Recording spoilage or damage for: <strong className="text-foreground">{product.name}</strong>
          </DialogDescription>
        </DialogHeader>
        
        <ScrollArea className="flex-1">
            <div className="p-8">
                {formBody}
            </div>
        </ScrollArea>

        <DialogFooter className="p-8 pt-4 border-t bg-background flex-shrink-0">
          <div className="flex flex-col gap-3 w-full">
            <Button type="submit" form="log-loss-strategic-form" className="w-full h-16 rounded-[2rem] text-xl font-black uppercase shadow-2xl shadow-primary/30 active:scale-95 transition-all" disabled={!!quantityError || !selectedBatchId || !watch('reason')}>Authorize Write-off</Button>
            <Button variant="ghost" type="button" onClick={() => onOpenChange(false)} className="w-full h-10 font-black uppercase tracking-widest text-[10px] text-slate-400">Cancel Protocol</Button>
          </div>
        </DialogFooter>
      </DialogContentContainer>
    </DialogContainer>
  );
};