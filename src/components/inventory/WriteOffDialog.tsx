

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
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';

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
  const {
    control,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm<WriteOffFormData>({
    resolver: zodResolver(writeOffSchema),
  });

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
  const quantityError = quantity > maxQuantity ? `Cannot write off more than available stock (${maxQuantity}).` : undefined;


  const handleFormSubmit = (data: WriteOffFormData) => {
    if (quantityError) return;
    onConfirm(product.id, data.batchId, data.quantity, data.reason, data.notes, data.imageUrl);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Write-Off / Damage</DialogTitle>
          <DialogDescription>
            Log a loss for: <span className="font-semibold">{product.name}</span>
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(handleFormSubmit)}>
          <div className="grid gap-6 py-4 max-h-[70vh] overflow-y-auto pr-4">
            <Controller
                name="batchId"
                control={control}
                render={({ field }) => (
                    <div className="space-y-2">
                        <Label htmlFor="batch-select">Batch to Write-Off</Label>
                        <Select onValueChange={field.onChange} value={field.value}>
                            <SelectTrigger id="batch-select">
                                <SelectValue placeholder="Select a batch" />
                            </SelectTrigger>
                            <SelectContent>
                                {product.batches.filter(b => b.stock > 0).map(batch => (
                                <SelectItem key={batch.id} value={batch.id}>
                                    {batch.stock} units @ ${batch.costPerUnit.toFixed(2)} (Received: {format(new Date(batch.receivedDate), 'MMM d, yyyy')})
                                </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {errors.batchId && <p className="text-sm text-destructive">{errors.batchId.message}</p>}
                    </div>
                )}
            />
            
            <div className="grid grid-cols-2 gap-4">
                 <Controller
                    name="quantity"
                    control={control}
                    render={({ field }) => (
                         <div className="space-y-2">
                            <Label htmlFor="quantity">Quantity</Label>
                            <Input id="quantity" type="number" {...field} disabled={!selectedBatch} />
                             {errors.quantity ? <p className="text-sm text-destructive">{errors.quantity.message}</p> :
                             quantityError && <p className="text-sm text-destructive">{quantityError}</p>}
                        </div>
                    )}
                 />
                 <Controller
                    name="reason"
                    control={control}
                    render={({ field }) => (
                        <div className="space-y-2">
                            <Label htmlFor="reason">Reason</Label>
                            <Select onValueChange={field.onChange} value={field.value}>
                                <SelectTrigger id="reason">
                                    <SelectValue placeholder="Select a reason" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Damaged on Arrival">Damaged on Arrival</SelectItem>
                                    <SelectItem value="Damaged in Store">Damaged in Store</SelectItem>
                                    <SelectItem value="Expired">Expired</SelectItem>
                                    <SelectItem value="Theft">Theft/Loss</SelectItem>
                                    <SelectItem value="Internal Use">Internal Use</SelectItem>
                                    <SelectItem value="Other">Other</SelectItem>
                                </SelectContent>
                            </Select>
                            {errors.reason && <p className="text-sm text-destructive">{errors.reason.message}</p>}
                        </div>
                    )}
                 />
            </div>
             <Controller
                name="notes"
                control={control}
                render={({ field }) => (
                    <div className="space-y-2">
                        <Label htmlFor="notes">Notes</Label>
                        <Textarea id="notes" placeholder="Optional: add details about the write-off." {...field} />
                    </div>
                )}
             />
             <Controller
                name="imageUrl"
                control={control}
                render={({ field }) => (
                    <div className="space-y-2">
                        <Label>Photo Evidence</Label>
                        <ImageUpload onImageUploaded={field.onChange} />
                    </div>
                )}
             />
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!!quantityError}>Write-Off Item</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
