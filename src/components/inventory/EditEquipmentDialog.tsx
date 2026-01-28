
'use client';

import React, { useEffect, useState } from 'react';
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
import { Button, buttonVariants } from '@/components/ui/button';
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
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Calendar } from '../ui/calendar';
import { cn } from '@/lib/utils';
import { Calendar as CalendarIcon, PlusCircle } from 'lucide-react';
import { format, parseISO } from 'date-fns';

const editEquipmentSchema = z.object({
  name: z.string().min(1, 'Equipment name is required.'),
  category: z.string().min(1, 'Category is required.'),
  purchaseCost: z.coerce.number().min(0, 'Purchase cost must be a positive number.'),
  purchaseDate: z.date({ required_error: 'A purchase date is required.' }),
  lifespanYears: z.coerce.number().min(0, 'Lifespan must be a positive number.'),
  supplier: z.string().optional(),
  supplierUrl: z.string().url({ message: "Please enter a valid URL." }).optional().or(z.literal('')),
  primaryLocationId: z.string().optional(),
  imageUrl: z.string().optional(),
  sku: z.string().optional(),
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
  onNewCategory,
  locations,
}) => {
  const methods = useForm<EditEquipmentFormData>({
    resolver: zodResolver(editEquipmentSchema),
  });

  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');

  useEffect(() => {
    if (equipment) {
      methods.reset({
        name: equipment.name,
        category: equipment.category,
        purchaseCost: equipment.costPerUnit,
        purchaseDate: new Date(equipment.batches[0].receivedDate),
        lifespanYears: equipment.lifespanYears,
        supplier: equipment.supplier,
        supplierUrl: equipment.supplierUrl,
        primaryLocationId: equipment.primaryLocationId,
        imageUrl: equipment.imageUrl,
        sku: equipment.sku,
      });
    }
  }, [equipment, methods]);

  const onSubmit = (data: EditEquipmentFormData) => {
    const updatedEquipment: InventoryItem = {
      ...equipment,
      name: data.name,
      category: data.category,
      costPerUnit: data.purchaseCost,
      lifespanYears: data.lifespanYears,
      supplier: data.supplier || '',
      supplierUrl: data.supplierUrl,
      primaryLocationId: data.primaryLocationId,
      imageUrl: data.imageUrl,
      sku: data.sku,
      batches: [{
        ...equipment.batches[0],
        costPerUnit: data.purchaseCost,
        receivedDate: data.purchaseDate.toISOString(),
      }],
    };
    onEquipmentUpdated(updatedEquipment);
  };
  
    const handleAddNewCategory = () => {
        if (newCategoryName.trim()) {
            onNewCategory(newCategoryName.trim());
            methods.setValue('category', newCategoryName.trim());
            setIsAddingCategory(false);
            setNewCategoryName('');
        }
    };


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit: {equipment.name}</DialogTitle>
          <DialogDescription>Update the details for this piece of equipment.</DialogDescription>
        </DialogHeader>
        <FormProvider {...methods}>
          <form onSubmit={methods.handleSubmit(onSubmit)} className="space-y-4 py-4 max-h-[70vh] overflow-y-auto pr-4 -mr-6 pl-6">
            <div className="space-y-2">
              <Label htmlFor="equipment-name-edit">Equipment Name</Label>
              <Input id="equipment-name-edit" {...methods.register('name')} />
              {methods.formState.errors.name && <p className="text-sm text-destructive">{methods.formState.errors.name.message}</p>}
            </div>
            <Controller
              name="category"
              control={methods.control}
              render={({ field }) => (
                <div className="space-y-2">
                  <Label htmlFor="category-edit">Category</Label>
                   {isAddingCategory ? (
                        <div className="flex gap-2">
                            <Input placeholder="New category..." value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} />
                            <Button onClick={handleAddNewCategory} type="button">Add</Button>
                        </div>
                    ) : (
                        <div className="flex gap-2">
                            <Select onValueChange={field.onChange} value={field.value}>
                                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                                <SelectContent>
                                    {equipmentCategories.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}
                                </SelectContent>
                            </Select>
                            <Button variant="outline" size="icon" onClick={() => setIsAddingCategory(true)} type="button"><PlusCircle className="h-4 w-4"/></Button>
                        </div>
                    )}
                  {methods.formState.errors.category && <p className="text-sm text-destructive">{methods.formState.errors.category.message}</p>}
                </div>
              )}
            />
            <div className="space-y-2">
              <Label htmlFor="purchase-cost-edit">Total Purchase Cost</Label>
              <Input id="purchase-cost-edit" type="number" {...methods.register('purchaseCost')} />
            </div>
            <Controller name="purchaseDate" control={methods.control} render={({ field }) => ( <div className="space-y-2"> <Label htmlFor="purchase-date-edit">Purchase Date</Label> <Popover> <PopoverTrigger className={cn( buttonVariants({ variant: 'outline' }), "w-full justify-start text-left font-normal", !field.value && "text-muted-foreground" )}> <span className="flex items-center"><CalendarIcon className="mr-2 h-4 w-4" /> {field.value ? format(field.value, "PPP") : "Pick a date"}</span> </PopoverTrigger> <PopoverContent className="w-auto p-0"> <Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus /> </PopoverContent> </Popover> {methods.formState.errors.purchaseDate && <p className="text-sm text-destructive">{methods.formState.errors.purchaseDate.message}</p>} </div> )}/>
            <div className="space-y-2">
              <Label htmlFor="lifespan-edit">Estimated Lifespan (Years)</Label>
              <Input id="lifespan-edit" type="number" {...methods.register('lifespanYears')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="supplier-edit">Supplier</Label>
              <Input id="supplier-edit" {...methods.register('supplier')} />
            </div>
             <div className="space-y-2">
              <Label htmlFor="sku-edit">SKU / Barcode</Label>
              <Input id="sku-edit" placeholder="Product identifier" {...methods.register('sku')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="supplierUrl-edit">Supplier URL</Label>
              <Input id="supplierUrl-edit" {...methods.register('supplierUrl')} />
               {methods.formState.errors.supplierUrl && <p className="text-sm text-destructive">{methods.formState.errors.supplierUrl.message}</p>}
            </div>
            <Controller
              name="primaryLocationId"
              control={methods.control}
              render={({ field }) => (
                <div className="space-y-2">
                  <Label htmlFor="location-edit">Storage Location</Label>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger id="location-edit"><SelectValue placeholder="Select a location" /></SelectTrigger>
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
