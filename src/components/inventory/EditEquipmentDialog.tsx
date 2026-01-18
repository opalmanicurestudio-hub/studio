
'use client';

import React, { useEffect } from 'react';
import { useForm, Controller, FormProvider } from 'react-hook-form';
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
import { ImageUpload } from '@/components/shared/ImageUpload';
import { type InventoryItem, type Location } from '@/lib/data';

const editEquipmentSchema = z.object({
  name: z.string().min(1, 'Equipment name is required.'),
  category: z.string().min(1, 'Category is required.'),
  purchaseCost: z.coerce.number().min(0, 'Purchase cost must be a positive number.'),
  lifespanYears: z.coerce.number().min(0, 'Lifespan must be a positive number.'),
  supplier: z.string().optional(),
  primaryLocationId: z.string().optional(),
  imageUrl: z.string().optional(),
});

type EditEquipmentFormData = z.infer<typeof editEquipmentSchema>;

interface EditEquipmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  equipment: InventoryItem;
  onEquipmentUpdated: (equipment: InventoryItem) => void;
  equipmentCategories: string[];
  onNewCategory: (category: string) => void;
  locations: Location[];
}

export const EditEquipmentDialog: React.FC<EditEquipmentDialogProps> = ({
  open,
  onOpenChange,
  equipment,
  onEquipmentUpdated,
  equipmentCategories,
  locations,
}) => {
  const methods = useForm<EditEquipmentFormData>({
    resolver: zodResolver(editEquipmentSchema),
  });

  useEffect(() => {
    if (equipment) {
      methods.reset({
        name: equipment.name,
        category: equipment.category,
        purchaseCost: equipment.costPerUnit,
        lifespanYears: equipment.lifespanYears,
        supplier: equipment.supplier,
        primaryLocationId: equipment.primaryLocationId,
        imageUrl: equipment.imageUrl,
      });
    }
  }, [equipment, methods]);

  const onSubmit = (data: EditEquipmentFormData) => {
    onEquipmentUpdated({
      ...equipment,
      name: data.name,
      category: data.category,
      costPerUnit: data.purchaseCost,
      lifespanYears: data.lifespanYears,
      supplier: data.supplier || '',
      primaryLocationId: data.primaryLocationId,
      imageUrl: data.imageUrl,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit: {equipment.name}</DialogTitle>
          <DialogDescription>Update the details for this piece of equipment.</DialogDescription>
        </DialogHeader>
        <FormProvider {...methods}>
          <form onSubmit={methods.handleSubmit(onSubmit)} className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="equipment-name">Equipment Name</Label>
              <Input id="equipment-name" {...methods.register('name')} />
              {methods.formState.errors.name && <p className="text-sm text-destructive">{methods.formState.errors.name.message}</p>}
            </div>
            <Controller
              name="category"
              control={methods.control}
              render={({ field }) => (
                <div className="space-y-2">
                  <Label htmlFor="category">Category</Label>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                    <SelectContent>
                      {equipmentCategories.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {methods.formState.errors.category && <p className="text-sm text-destructive">{methods.formState.errors.category.message}</p>}
                </div>
              )}
            />
            <div className="space-y-2">
              <Label htmlFor="purchase-cost">Total Purchase Cost</Label>
              <Input id="purchase-cost" type="number" {...methods.register('purchaseCost')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lifespan">Estimated Lifespan (Years)</Label>
              <Input id="lifespan" type="number" {...methods.register('lifespanYears')} />
            </div>
            <Controller
              name="primaryLocationId"
              control={methods.control}
              render={({ field }) => (
                <div className="space-y-2">
                  <Label htmlFor="location">Storage Location</Label>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger id="location"><SelectValue placeholder="Select a location" /></SelectTrigger>
                    <SelectContent>
                      {locations.map(loc => <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            />
            <Controller
              name="imageUrl"
              control={methods.control}
              render={({ field }) => (
                <div className="space-y-2">
                  <Label>Equipment Image</Label>
                  <ImageUpload onImageUploaded={field.onChange} initialImage={field.value} />
                </div>
              )}
            />
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
