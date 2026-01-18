

'use client';

import React, { useState, useEffect } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { ArrowLeft, PlusCircle, DollarSign, Calendar as CalendarIcon } from 'lucide-react';
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
import { useForm, Controller, FormProvider } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { type InventoryItem, type Location } from '@/lib/data';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ImageUpload } from '@/components/shared/ImageUpload';
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

const EquipmentForm = ({
  equipmentCategories,
  onNewCategory,
  locations,
}: {
  equipmentCategories: string[];
  onNewCategory: (category: string) => void;
  locations: Location[];
}) => {
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
    <div className="space-y-6">
      <Controller name="name" control={control} render={({ field }) => ( <div className="space-y-2"> <Label htmlFor="equipment-name">Equipment Name</Label> <Input id="equipment-name" placeholder="e.g., Hydraulic Styling Chair" {...field} /> {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>} </div> )}/>
      <Controller name="category" control={control} render={({ field }) => ( <div className="space-y-2"> <Label htmlFor="category">Category</Label> {isAddingCategory ? ( <div className="flex gap-2"> <Input placeholder="New category..." value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} /> <Button onClick={handleAddNewCategory} type="button">Add</Button> </div> ) : ( <div className="flex gap-2"> <Select onValueChange={field.onChange} value={field.value}> <SelectTrigger> <SelectValue placeholder="Select category" /> </SelectTrigger> <SelectContent> {equipmentCategories.map(cat => ( <SelectItem key={cat} value={cat}>{cat}</SelectItem> ))} </SelectContent> </Select> <Button variant="outline" size="icon" onClick={() => setIsAddingCategory(true)} type="button"> <PlusCircle className="h-4 w-4" /> </Button> </div> )} {errors.category && <p className="text-sm text-destructive">{errors.category.message}</p>} </div> )}/>
      <Controller name="purchaseCost" control={control} render={({ field }) => ( <div className="space-y-2"> <Label htmlFor="purchase-cost">Total Purchase Cost</Label> <div className="relative"> <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /> <Input id="purchase-cost" type="number" placeholder="0.00" className="pl-8" {...field} /> </div> {errors.purchaseCost && <p className="text-sm text-destructive">{errors.purchaseCost.message}</p>} </div> )}/>
      <Controller name="lifespanYears" control={control} render={({ field }) => ( <div className="space-y-2"> <Label htmlFor="lifespan">Estimated Lifespan (Years)</Label> <Input id="lifespan" type="number" placeholder="e.g., 5" {...field} /> {errors.lifespanYears && <p className="text-sm text-destructive">{errors.lifespanYears.message}</p>} </div> )}/>
      <Controller name="purchaseDate" control={control} render={({ field }) => ( <div className="space-y-2"> <Label htmlFor="purchase-date">Purchase Date</Label> <Popover> <PopoverTrigger className={cn(buttonVariants({ variant: 'outline' }), 'w-full justify-start text-left font-normal', !field.value && 'text-muted-foreground')}> <span className="flex items-center"><CalendarIcon className="mr-2 h-4 w-4" />{field.value ? format(field.value, "PPP") : "Pick a date"}</span> </PopoverTrigger> <PopoverContent className="w-auto p-0"> <Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus /> </PopoverContent> </Popover> {errors.purchaseDate && <p className="text-sm text-destructive">{errors.purchaseDate.message}</p>} </div> )}/>
      <Controller name="primaryLocationId" control={control} render={({ field }) => ( <div className="space-y-2"> <Label htmlFor="location">Storage Location</Label> <Select onValueChange={field.onChange} value={field.value}> <SelectTrigger id="location"> <SelectValue placeholder="Select a location" /> </SelectTrigger> <SelectContent> {locations.map(loc => <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>)} </SelectContent> </Select> </div> )}/>
      <Controller name="imageUrl" control={control} render={({ field }) => ( <div className="space-y-2"> <Label>Equipment Image</Label> <ImageUpload onImageUploaded={field.onChange} /> </div> )}/>
    </div>
  );
};


export const AddEquipmentDialog = ({
  open,
  onOpenChange,
  onEquipmentAdded,
  equipmentCategories,
  onNewCategory,
  locations,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEquipmentAdded: (equipment: InventoryItem) => void;
  equipmentCategories: string[];
  onNewCategory: (category: string) => void;
  locations: Location[];
}) => {
  const isMobile = useIsMobile();
  const methods = useForm<EquipmentFormData>({
    resolver: zodResolver(equipmentSchema),
    defaultValues: {
      name: '',
      category: '',
      purchaseCost: undefined,
      lifespanYears: 5,
      purchaseDate: new Date(),
      supplier: '',
      supplierUrl: '',
      primaryLocationId: '',
      imageUrl: '',
    },
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
    onOpenChange(false);
  };
  
  const handleOpenChange = (isOpen: boolean) => {
    onOpenChange(isOpen);
    if (!isOpen) {
      reset();
    }
  };
  
  const formId = "add-equipment-form";
  const title = "Add New Equipment";
  const description = "Log a new capital asset like a chair, station, or electronic device.";

  const formContent = <EquipmentForm equipmentCategories={equipmentCategories} onNewCategory={onNewCategory} locations={locations} />;

  const DialogContainer = isMobile ? Sheet : Dialog;
  const DialogContentContainer = isMobile ? SheetContent : DialogContent;

  return (
    <FormProvider {...methods}>
      <DialogContainer open={open} onOpenChange={handleOpenChange}>
        <DialogContentContainer
          className={isMobile ? "max-h-[90dvh] flex flex-col p-0" : "sm:max-w-lg max-h-[90vh] flex flex-col p-0"}
          side="bottom"
        >
          <form id={formId} onSubmit={handleSubmit(handleSave)} className="flex flex-col h-full">
            <DialogHeader className={isMobile ? "p-4 border-b text-left" : "p-6 pb-4"}>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </DialogHeader>
            <ScrollArea className="flex-1 min-h-0">
              <div className={isMobile ? "px-4 py-6" : "px-6 pb-6"}>
                {formContent}
              </div>
            </ScrollArea>
            <DialogFooter className={isMobile ? "p-4 border-t" : "p-4 border-t"}>
              <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" form={formId}>Save Equipment</Button>
            </DialogFooter>
          </form>
        </DialogContentContainer>
      </DialogContainer>
    </FormProvider>
  );
};
