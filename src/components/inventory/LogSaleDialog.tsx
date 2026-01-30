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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { type InventoryItem } from '@/lib/data';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useToast } from '@/hooks/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { DollarSign } from 'lucide-react';
import { Card, CardContent } from '../ui/card';

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
  const {
    control,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm<SaleFormData>({
    resolver: zodResolver(saleSchema),
    defaultValues: { quantity: 1, paymentMethod: 'Card' },
  });
  const { toast } = useToast();

  const quantity = watch('quantity');
  const maxQuantity = product?.totalStock || 0;
  const quantityError = quantity > maxQuantity ? `Only ${maxQuantity} in stock.` : undefined;

  useEffect(() => {
    if (open) {
      reset({ quantity: 1, paymentMethod: 'Card' });
    }
  }, [open, reset]);

  const handleFormSubmit = (data: SaleFormData) => {
    if (quantityError || !product) return;
    const result = onConfirm(product.id, data.quantity, data.paymentMethod);
    
    if (result.success) {
        toast({
            title: 'Sale Logged',
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

  if (!product) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log Retail Sale</DialogTitle>
          <DialogDescription>
            Manually deduct stock for an in-person sale of: <span className="font-semibold">{product.name}</span>
          </DialogDescription>
        </DialogHeader>
        <form id="log-sale-form" onSubmit={handleSubmit(handleFormSubmit)}>
          <div className="grid gap-6 py-4">
            <Controller
                name="quantity"
                control={control}
                render={({ field }) => (
                     <div className="space-y-2">
                        <Label htmlFor="quantity-sale">Quantity Sold</Label>
                        <Input id="quantity-sale" type="number" {...field} />
                        {(errors.quantity || quantityError) && <p className="text-sm text-destructive">{errors.quantity?.message || quantityError}</p>}
                    </div>
                )}
            />
            <Controller
                name="paymentMethod"
                control={control}
                render={({ field }) => (
                    <div className="space-y-2">
                        <Label htmlFor="payment-method-sale">Payment Method</Label>
                        <Select onValueChange={field.onChange} value={field.value}>
                            <SelectTrigger id="payment-method-sale"><SelectValue placeholder="Select a method" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="Card">Card</SelectItem>
                                <SelectItem value="Cash">Cash</SelectItem>
                                <SelectItem value="Other">Other</SelectItem>
                            </SelectContent>
                        </Select>
                        {errors.paymentMethod && <p className="text-sm text-destructive">{errors.paymentMethod.message}</p>}
                    </div>
                )}
            />
            <Card className="bg-muted/50">
                <CardContent className="p-3 flex items-center justify-between">
                    <span className="font-medium">Total Sale:</span>
                    <span className="text-lg font-bold text-primary">${((product.msrp || product.costPerUnit || 0) * (quantity || 0)).toFixed(2)}</span>
                </CardContent>
            </Card>
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="log-sale-form" disabled={!!quantityError}>Log Sale</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
