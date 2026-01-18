
'use client';

import React, { useState, useEffect } from 'react';
import { useForm, FormProvider, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { ImageUpload } from '@/components/shared/ImageUpload';
import { type InventoryItem, type Location } from '@/lib/data';

const editProductSchema = z.object({
  name: z.string().min(1, 'Product name is required'),
  category: z.string().min(1, 'Category is required'),
  type: z.enum(['professional', 'retail', 'equipment', 'overhead']),
  supplier: z.string().optional(),
  supplierUrl: z.string().url().optional().or(z.literal('')),
  costPerUnit: z.coerce.number().optional(),
  reorderPoint: z.coerce.number().optional(),
  imageUrl: z.string().optional(),
  primaryLocationId: z.string().optional(),
});

type EditProductFormData = z.infer<typeof editProductSchema>;

interface EditProductDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: InventoryItem;
  onProductUpdated: (product: InventoryItem) => void;
  categories: string[];
  onNewCategory: (category: string) => void;
  locations: Location[];
  onAddLocationClick: () => void;
}

export const EditProductDialog: React.FC<EditProductDialogProps> = ({
  open,
  onOpenChange,
  product,
  onProductUpdated,
  categories,
  locations,
}) => {
  const methods = useForm<EditProductFormData>({
    resolver: zodResolver(editProductSchema),
  });

  useEffect(() => {
    if (product) {
      methods.reset({
        name: product.name,
        category: product.category,
        type: product.type,
        supplier: product.supplier,
        supplierUrl: product.supplierUrl,
        costPerUnit: product.costPerUnit,
        reorderPoint: product.reorderPoint,
        imageUrl: product.imageUrl,
        primaryLocationId: product.primaryLocationId,
      });
    }
  }, [product, methods]);

  const onSubmit = (data: EditProductFormData) => {
    onProductUpdated({ ...product, ...data });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit: {product.name}</DialogTitle>
          <DialogDescription>Update the details for this product.</DialogDescription>
        </DialogHeader>
        <FormProvider {...methods}>
          <form onSubmit={methods.handleSubmit(onSubmit)} className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Product Name</Label>
              <Input id="name" {...methods.register('name')} />
              {methods.formState.errors.name && <p className="text-sm text-destructive">{methods.formState.errors.name.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="category">Category</Label>
              <Controller
                name="category"
                control={methods.control}
                render={({ field }) => (
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {categories.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
             <div className="space-y-2">
              <Label htmlFor="costPerUnit">Cost Per Unit</Label>
              <Input id="costPerUnit" type="number" {...methods.register('costPerUnit')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="supplier">Supplier</Label>
              <Input id="supplier" {...methods.register('supplier')} />
            </div>
             <div className="space-y-2">
              <Label htmlFor="reorderPoint">Reorder Point</Label>
              <Input id="reorderPoint" type="number" {...methods.register('reorderPoint')} />
            </div>
            <div className="space-y-2">
              <Label>Image</Label>
               <Controller
                  name="imageUrl"
                  control={methods.control}
                  render={({ field }) => (
                    <ImageUpload onImageUploaded={field.onChange} initialImage={field.value} />
                  )}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit">Save Changes</Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
};
