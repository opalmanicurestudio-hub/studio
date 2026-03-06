'use client';

import React, { useEffect } from 'react';
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { Resource, InventoryItem } from '@/lib/data';

const resourceSchema = z.object({
  name: z.string().min(1, 'Resource name is required'),
  type: z.enum(['room', 'equipment']),
  capacity: z.coerce.number().min(1, 'Capacity must be at least 1').optional(),
  inventoryItemId: z.string().optional(),
}).refine(data => data.type !== 'equipment' || !!data.inventoryItemId, {
    message: "Please select an inventory item for equipment.",
    path: ["inventoryItemId"],
});

type ResourceFormData = z.infer<typeof resourceSchema>;

interface EditResourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resource: Resource;
  onSave: (resourceData: Resource) => void;
  equipmentInventory: InventoryItem[];
}

export const EditResourceDialog: React.FC<EditResourceDialogProps> = ({
  open,
  onOpenChange,
  resource,
  onSave,
  equipmentInventory
}) => {
  const { control, handleSubmit, register, watch, reset, setValue, formState: { errors } } = useForm<ResourceFormData>({
    resolver: zodResolver(resourceSchema),
  });

  const resourceType = watch('type');
  const selectedInventoryItemId = watch('inventoryItemId');

  useEffect(() => {
    if (resource && open) {
      reset({
        name: resource.name,
        type: resource.type,
        capacity: resource.capacity || 1,
        inventoryItemId: resource.inventoryItemId,
      });
    }
  }, [resource, open, reset]);

  useEffect(() => {
    if (resourceType === 'equipment' && selectedInventoryItemId) {
        const item = equipmentInventory.find(i => i.id === selectedInventoryItemId);
        if (item && item.name !== watch('name')) {
            setValue('name', item.name);
        }
    }
  }, [selectedInventoryItemId, resourceType, equipmentInventory, setValue, watch]);

  const handleSave = (data: ResourceFormData) => {
    onSave({
      ...resource,
      name: data.name,
      type: data.type,
      capacity: data.capacity,
      inventoryItemId: data.type === 'equipment' ? data.inventoryItemId : undefined,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit(handleSave)}>
            <DialogHeader>
            <DialogTitle>Edit Resource</DialogTitle>
            <DialogDescription>
                Update the details for this bookable asset.
            </DialogDescription>
            </DialogHeader>
            <div className="grid gap-6 py-4">
                <Controller
                name="type"
                control={control}
                render={({ field }) => (
                    <div className="space-y-2">
                    <Label>Resource Type</Label>
                    <RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 gap-2">
                        <div>
                        <RadioGroupItem value="room" id="room-edit" className="peer sr-only" />
                        <Label htmlFor="room-edit" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Room/Station</Label>
                        </div>
                        <div>
                        <RadioGroupItem value="equipment" id="equipment-edit" className="peer sr-only" />
                        <Label htmlFor="equipment-edit" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Equipment</Label>
                        </div>
                    </RadioGroup>
                    </div>
                )}
                />
                {resourceType === 'equipment' ? (
                    <Controller
                        name="inventoryItemId"
                        control={control}
                        render={({ field }) => (
                            <div className="space-y-2">
                                <Label htmlFor="inventory-item-edit">Link to Inventory Item</Label>
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <SelectTrigger id="inventory-item-edit"><SelectValue placeholder="Select equipment..." /></SelectTrigger>
                                    <SelectContent>{equipmentInventory.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
                                </Select>
                                {errors.inventoryItemId && <p className="text-sm text-destructive">{errors.inventoryItemId.message}</p>}
                            </div>
                        )}
                    />
                ) : (
                    <div className="space-y-2">
                        <Label htmlFor="resource-name-edit">Name</Label>
                        <Input id="resource-name-edit" {...register('name')} placeholder="e.g., Facial Room 1" />
                        {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
                    </div>
                )}
                <div className="space-y-2">
                <Label htmlFor="capacity-edit">Capacity</Label>
                <Input id="capacity-edit" type="number" {...register('capacity')} />
                <p className="text-xs text-muted-foreground">How many clients can use this resource at once?</p>
                {errors.capacity && <p className="text-sm text-destructive">{errors.capacity.message}</p>}
                </div>
            </div>
            <DialogFooter>
                <Button variant="outline" onClick={() => onOpenChange(false)} type="button">
                Cancel
                </Button>
                <Button type="submit">Save Changes</Button>
            </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
