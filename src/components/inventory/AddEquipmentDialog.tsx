
'use client';

import React, { useState } from 'react';
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
import { PlusCircle, Upload, Calendar as CalendarIcon, DollarSign } from 'lucide-react';
import { useForm, Controller, FormProvider, useFormContext } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { type InventoryItem, type Location } from '@/lib/data';
import { Calendar } from '../ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ImageUpload } from '../shared/ImageUpload';
import { useToast } from '@/hooks/use-toast';
import { useIsMobile } from '@/hooks/use-mobile';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '../ui/sheet';
import { ScrollArea } from '../ui/scroll-area';

const equipmentSchema = z.object({
  name: z.string().min(1, 'Equipment name is required.'),
  category: z.string().min(1, 'Category is required.'),
  purchaseCost: z.coerce.number().min(0, 'Purchase cost must be a positive number.'),
  lifespanYears: z.coerce.number().min(0, 'Lifespan must be a positive number.'),
  purchaseDate: z.date({ required_error: 'A purchase date is required.' }),
  supplier: z.string().optional(),
  supplierUrl: z.string().url().optional().or(z.literal('')),
  primaryLocationId: z.string().optional(),
  imageUrl: z.string().optional(),
});

type EquipmentFormData = z.infer<typeof equipmentSchema>;

const EquipmentFormContent = ({ categories, onNewCategory, locations }: { categories: string[], onNewCategory: (cat: string) => void, locations: Location[]}) => {
  const { control, setValue, formState: { errors } } = useFormContext<EquipmentFormData>();
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');

  const handleAddNewCategory = () => {
    if (newCategoryName.trim()) {
      onNewCategory(newCategoryName.trim());
      setValue('category', newCategoryName.trim());
      setIsAddingCategory(false);
      setNewCategoryName('');
    }
  };

  return (
    <div className="grid gap-4 py-4">
      <Controller
        name="name"
        control={control}
        render={({ field }) => (
          <div className="space-y-2">
            <Label htmlFor="equipment-name">Equipment Name</Label>
            <Input id="equipment-name" placeholder="e.g., Hydraulic Styling Chair" {...field} />
            {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
          </div>
        )}
      />
      <Controller
        name="category"
        control={control}
        render={({ field }) => (
           <div className="space-y-2">
              <Label htmlFor="category">Category</Label>
              {isAddingCategory ? (
                  <div className="flex gap-2">
                  <Input
                      placeholder="New category..."
                      value={newCategoryName}
                      onChange={(e) => setNewCategoryName(e.target.value)}
                  />
                  <Button onClick={handleAddNewCategory} type="button">Add</Button>
                  </div>
              ) : (
                  <div className="flex gap-2">
                  <Select onValueChange={field.onChange} value={field.value}>
                      <SelectTrigger>
                      <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                      {categories.map(cat => (
                          <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                      ))}
                      </SelectContent>
                  </Select>
                  <Button variant="outline" size="icon" onClick={() => setIsAddingCategory(true)} type="button">
                      <PlusCircle className="h-4 w-4" />
                  </Button>
                  </div>
              )}
              {errors.category && <p className="text-sm text-destructive">{errors.category.message}</p>}
          </div>
        )}
      />
      <Controller
        name="purchaseCost"
        control={control}
        render={({ field }) => (
          <div className="space-y-2">
            <Label htmlFor="purchase-cost">Total Purchase Cost</Label>
             <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input id="purchase-cost" type="number" placeholder="0.00" className="pl-8" {...field} />
              </div>
            {errors.purchaseCost && <p className="text-sm text-destructive">{errors.purchaseCost.message}</p>}
          </div>
        )}
      />
       <Controller
        name="lifespanYears"
        control={control}
        render={({ field }) => (
          <div className="space-y-2">
            <Label htmlFor="lifespan">Estimated Lifespan (Years)</Label>
            <Input id="lifespan" type="number" placeholder="e.g., 5" {...field} />
            {errors.lifespanYears && <p className="text-sm text-destructive">{errors.lifespanYears.message}</p>}
          </div>
        )}
      />
       <Controller
        name="purchaseDate"
        control={control}
        render={({ field }) => (
          <div className="space-y-2">
              <Label htmlFor="purchase-date">Purchase Date</Label>
              <Popover>
                  <PopoverTrigger asChild>
                  <Button
                      variant={"outline"}
                      className={cn(
                      "w-full justify-start text-left font-normal",
                      !field.value && "text-muted-foreground"
                      )}
                  >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {field.value ? format(field.value, "PPP") : <span>Pick a date</span>}
                  </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                  <Calendar
                      mode="single"
                      selected={field.value}
                      onSelect={field.onChange}
                      initialFocus
                  />
                  </PopoverContent>
              </Popover>
              {errors.purchaseDate && <p className="text-sm text-destructive">{errors.purchaseDate.message}</p>}
          </div>
        )}
      />
       <Controller
        name="primaryLocationId"
        control={control}
        render={({ field }) => (
          <div className="space-y-2">
            <Label htmlFor="location">Storage Location</Label>
            <Select onValueChange={field.onChange} value={field.value}>
              <SelectTrigger id="location">
                <SelectValue placeholder="Select a location" />
              </SelectTrigger>
              <SelectContent>
                {locations.map(loc => <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      />
       <Controller
        name="imageUrl"
        control={control}
        render={({ field }) => (
          <div className="space-y-2">
              <Label>Equipment Image</Label>
              <ImageUpload onImageUploaded={field.onChange} />
          </div>
        )}
      />
    </div>
  )
}

export const AddEquipmentDialog = ({
  open,
  onOpenChange,
  categories,
  onNewCategory,
  onEquipmentAdded,
  locations,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: string[];
  onNewCategory: (category: string) => void;
  onEquipmentAdded: (equipment: InventoryItem) => void;
  locations: Location[];
}) => {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const methods = useForm<EquipmentFormData>({
    resolver: zodResolver(equipmentSchema),
  });
  const { handleSubmit, reset } = methods;


  const handleSave = (data: EquipmentFormData) => {
    const newEquipment: InventoryItem = {
      id: `equip-${Date.now()}`,
      name: data.name,
      type: 'equipment',
      category: data.category,
      totalStock: 1,
      costPerUnit: data.purchaseCost,
      lifespanYears: data.lifespanYears,
      supplier: data.supplier || '',
      supplierUrl: data.supplierUrl,
      primaryLocationId: data.primaryLocationId,
      imageUrl: data.imageUrl,
      batches: [{
        id: `batch-${Date.now()}`,
        stock: 1,
        costPerUnit: data.purchaseCost,
        receivedDate: data.purchaseDate.toISOString(),
      }],
    };
    onEquipmentAdded(newEquipment);
    handleClose();
  };
  
  const handleClose = () => {
    reset();
    onOpenChange(false);
  }
  
  const FormContent = <EquipmentFormContent categories={categories} onNewCategory={onNewCategory} locations={locations} />;
  const formId = "add-equipment-form";

  if (isMobile) {
      return (
        <Sheet open={open} onOpenChange={handleClose}>
            <SheetContent side="bottom" className="h-[95vh] flex flex-col p-0">
                <FormProvider {...methods}>
                    <form id={formId} onSubmit={handleSubmit(handleSave)} className="flex flex-col flex-1 min-h-0">
                        <SheetHeader className="p-4 border-b text-left">
                            <SheetTitle>Add New Equipment</SheetTitle>
                            <SheetDescription>
                                Log a new capital asset like a chair, station, or electronic device.
                            </SheetDescription>
                        </SheetHeader>

                        <div className="flex-1 min-h-0">
                          <ScrollArea className="h-full px-4">
                            {FormContent}
                          </ScrollArea>
                        </div>
                        
                        <SheetFooter className="p-4 border-t">
                          <Button variant="outline" onClick={handleClose} type="button">Cancel</Button>
                          <Button type="submit">Save Equipment</Button>
                        </SheetFooter>
                    </form>
                </FormProvider>
            </SheetContent>
        </Sheet>
      )
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <FormProvider {...methods}>
          <form id={formId} onSubmit={handleSubmit(handleSave)}>
            <DialogHeader>
              <DialogTitle>Add New Equipment</DialogTitle>
              <DialogDescription>
                Log a new capital asset like a chair, station, or electronic device.
              </DialogDescription>
            </DialogHeader>
            <ScrollArea className="max-h-[70vh] -mr-6 pr-6">
              <div className="px-6">
                {FormContent}
              </div>
            </ScrollArea>
            <DialogFooter className="pt-4 border-t mt-4 pr-6">
              <Button variant="outline" onClick={handleClose} type="button">
                Cancel
              </Button>
              <Button type="submit">Save Equipment</Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
};
