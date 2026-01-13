
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
import { useToast } from '@/hooks/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

const useSchema = z.object({
  productId: z.string().min(1, 'Product selection is required.'),
  quantity: z.coerce.number().min(0.1, 'Quantity must be greater than 0.'),
  reason: z.string().optional(),
});

type UseFormData = z.infer<typeof useSchema>;

interface LogUseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: InventoryItem | null; // Can be null if dialogType is 'overhead'
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log Manual Use</DialogTitle>
          <DialogDescription>
            {dialogType === 'product' && product ? `Deduct stock for: ${product.name}` : 'Deduct stock for an overhead item.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(handleFormSubmit)}>
          <div className="grid gap-6 py-4">
            {dialogType === 'overhead' && (
                <Controller
                    name="productId"
                    control={control}
                    render={({ field }) => (
                        <div className="space-y-2">
                        <Label htmlFor="product-select">Overhead Item</Label>
                        <Select onValueChange={field.onChange} value={field.value}>
                            <SelectTrigger id="product-select">
                            <SelectValue placeholder="Select an item" />
                            </SelectTrigger>
                            <SelectContent>
                            {overheadItems.map(item => (
                                <SelectItem key={item.id} value={item.id}>
                                {item.name} ({item.totalStock} in stock)
                                </SelectItem>
                            ))}
                            </SelectContent>
                        </Select>
                        {errors.productId && <p className="text-sm text-destructive">{errors.productId.message}</p>}
                        </div>
                    )}
                />
            )}
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
