
'use client';

import React from 'react';
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
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { Resource } from '@/lib/data';

const resourceSchema = z.object({
  name: z.string().min(1, 'Resource name is required'),
  type: z.string().min(1, 'Resource type is required'),
  capacity: z.coerce.number().min(1, 'Capacity must be at least 1'),
});

type ResourceFormData = z.infer<typeof resourceSchema>;

interface AddResourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (resourceData: Omit<Resource, 'id'>) => void;
}

export const AddResourceDialog: React.FC<AddResourceDialogProps> = ({
  open,
  onOpenChange,
  onSave,
}) => {
  const { control, handleSubmit, register, formState: { errors } } = useForm<ResourceFormData>({
    resolver: zodResolver(resourceSchema),
  });

  const handleSave = (data: ResourceFormData) => {
    onSave(data);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add New Resource</DialogTitle>
          <DialogDescription>
            Create a new bookable resource like a room or piece of equipment.
          </DialogDescription>
        </DialogHeader>
        <form id="add-resource-form" onSubmit={handleSubmit(handleSave)}>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="resource-name">Resource Name</Label>
              <Input id="resource-name" {...register('name')} placeholder="e.g., Treatment Room A" />
              {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
            </div>
             <div className="space-y-2">
              <Label htmlFor="resource-type">Type</Label>
              <Input id="resource-type" {...register('type')} placeholder="e.g., Room, Equipment" />
              {errors.type && <p className="text-sm text-destructive">{errors.type.message}</p>}
            </div>
             <div className="space-y-2">
              <Label htmlFor="resource-capacity">Capacity</Label>
              <Input id="resource-capacity" type="number" {...register('capacity')} defaultValue={1}/>
               {errors.capacity && <p className="text-sm text-destructive">{errors.capacity.message}</p>}
            </div>
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="add-resource-form">Save Resource</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
