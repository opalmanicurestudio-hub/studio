
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
import { type InventoryItem } from '@/lib/data';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

const useSchema = z.object({
  quantity: z.coerce.number().min(0.1, 'Quantity must be greater than 0.'),
  reason: z.string().optional(),
});

type UseFormData = z.infer<typeof useSchema>;

interface LogUseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: InventoryItem;
  onConfirm: (productId: string, quantity: number, notes: string) => { success: boolean, message: string };
}

export const LogUseDialog: React.FC<LogUseDialogProps> = ({
  open,
  onOpenChange,
  product,
  onConfirm,
}) => {
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<UseFormData>({
    resolver: zodResolver(useSchema),
    defaultValues: {
      quantity: 1,
    }
  });
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      reset({ quantity: 1, reason: '' });
    }
  }, [open, reset]);

  const handleFormSubmit = (data: UseFormData) => {
    const result = onConfirm(product.id, data.quantity, data.reason || 'Manual Use Log');
    
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

  const unitLabel = product.costingMethod === 'uses' ? 'Uses' : product.unit || 'units';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log Manual Use</DialogTitle>
          <DialogDescription>
            Deduct stock for: <span className="font-semibold">{product.name}</span>
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(handleFormSubmit)}>
          <div className="grid gap-6 py-4">
            <Controller
                name="quantity"
                control={control}
                render={({ field }) => (
                     <div className="space-y-2">
                        <Label htmlFor="quantity">Quantity to Deduct</Label>
                        <div className="relative">
                             <Input id="quantity" type="number" step="0.1" {...field} />
                             <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{unitLabel}</span>
                        </div>
                        {errors.quantity && <p className="text-sm text-destructive">{errors.quantity.message}</p>}
                    </div>
                )}
            />
            <Controller
                name="reason"
                control={control}
                render={({ field }) => (
                    <div className="space-y-2">
                        <Label htmlFor="reason">Reason / Note (Optional)</Label>
                        <Textarea id="reason" placeholder="e.g., Dropped bottle, product test" {...field} />
                    </div>
                )}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Log Use</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
