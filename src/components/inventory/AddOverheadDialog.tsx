
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
import { PlusCircle, Calendar as CalendarIcon, DollarSign } from 'lucide-react';
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
import { useForm, Controller, FormProvider, useFormContext } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { type InventoryItem, type Location } from '@/lib/data';
import { Calendar } from '../ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { ScrollArea } from '../ui/scroll-area';

const overheadSchema = z.object({
  name: z.string().min(1, 'Item name is required.'),
  category: z.string().min(1, 'Category is required.'),
  purchaseCost: z.coerce.number().min(0, 'Purchase cost must be a positive number.'),
  purchaseDate: z.date({ required_error: 'A purchase date is required.' }),
  costingMethod: z.enum(['size', 'uses']),
  containerSize: z.number().optional(),
  containerUnit: z.string().optional(),
  usesPerContainer: z.number().optional(),
  initialStock: z.coerce.number().min(1, 'Initial stock must be at least 1.'),
  supplier: z.string().optional(),
  primaryLocationId: z.string().optional(),
});

type OverheadFormData = z.infer<typeof overheadSchema>;

const OverheadFormContent = ({ categories, onNewCategory, locations, costingMethod }: { categories: string[], onNewCategory: (cat: string) => void, locations: Location[], costingMethod: 'size' | 'uses'}) => {
    const { control, setValue, formState: { errors } } = useFormContext<OverheadFormData>();
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
            <Controller name="name" control={control} render={({ field }) => (
              <div className="space-y-2"><Label htmlFor="item-name">Item Name</Label><Input id="item-name" placeholder="e.g., Disinfectant Wipes" {...field} />{errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}</div>
            )}/>
             <Controller name="category" control={control} render={({ field }) => (
                 <div className="space-y-2">
                    <Label htmlFor="category">Category</Label>
                    {isAddingCategory ? (
                        <div className="flex gap-2"><Input placeholder="New category..." value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} /><Button onClick={handleAddNewCategory} type="button">Add</Button></div>
                    ) : (
                        <div className="flex gap-2">
                        <Select onValueChange={field.onChange} value={field.value}><SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger><SelectContent>{categories.map(cat => (<SelectItem key={cat} value={cat}>{cat}</SelectItem>))}</SelectContent></Select>
                        <Button variant="outline" size="icon" onClick={() => setIsAddingCategory(true)} type="button"><PlusCircle className="h-4 w-4" /></Button>
                        </div>
                    )}
                    {errors.category && <p className="text-sm text-destructive">{errors.category.message}</p>}
                </div>
              )}/>
            <div className="grid grid-cols-2 gap-4">
                <Controller name="purchaseCost" control={control} render={({ field }) => (
                    <div className="space-y-2"><Label htmlFor="purchase-cost">Total Purchase Cost</Label><div className="relative"><DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input id="purchase-cost" type="number" placeholder="0.00" className="pl-8" {...field} /></div>{errors.purchaseCost && <p className="text-sm text-destructive">{errors.purchaseCost.message}</p>}</div>
                )}/>
                 <Controller name="initialStock" control={control} render={({ field }) => (
                    <div className="space-y-2"><Label htmlFor="initial-stock">Number of Containers</Label><Input id="initial-stock" type="number" placeholder="e.g., 12" {...field} />{errors.initialStock && <p className="text-sm text-destructive">{errors.initialStock.message}</p>}</div>
                )}/>
            </div>
             <Controller name="purchaseDate" control={control} render={({ field }) => (
                <div className="space-y-2">
                    <Label htmlFor="purchase-date">Purchase Date</Label>
                    <Popover><PopoverTrigger asChild><Button variant={'outline'} className={cn("w-full justify-start text-left font-normal", !field.value && "text-muted-foreground")}><span className="flex items-center"><CalendarIcon className="mr-2 h-4 w-4" />{field.value ? format(field.value, 'PPP') : 'Pick a date'}</span></Button></PopoverTrigger><PopoverContent className="w-auto p-0"><Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus /></PopoverContent></Popover>
                    {errors.purchaseDate && <p className="text-sm text-destructive">{errors.purchaseDate.message}</p>}
                </div>
              )}/>
            <Controller name="costingMethod" control={control} render={({ field }) => (
                <div className="space-y-2"><Label>Consumption Tracking</Label><RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 gap-2"><div><RadioGroupItem value="size" id="size" className="peer sr-only" /><Label htmlFor="size" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">By Size</Label></div><div><RadioGroupItem value="uses" id="uses" className="peer sr-only" /><Label htmlFor="uses" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">By Uses</Label></div></RadioGroup></div>
            )}/>
            {costingMethod === 'size' && (
                <div className="grid grid-cols-2 gap-4"><Controller name="containerSize" control={control} render={({ field }) => (<div className="space-y-2"><Label htmlFor="container-size">Container Size</Label><Input id="container-size" type="number" placeholder="e.g., 1000" {...field} /></div>)}/><Controller name="containerUnit" control={control} render={({ field }) => (<div className="space-y-2"><Label htmlFor="unit">Unit</Label><Select onValueChange={field.onChange} value={field.value}><SelectTrigger id="unit"><SelectValue placeholder="Select unit" /></SelectTrigger><SelectContent><SelectItem value="ml">ml</SelectItem><SelectItem value="oz">oz</SelectItem><SelectItem value="g">g</SelectItem><SelectItem value="sheets">sheets</SelectItem></SelectContent></Select></div>)}/></div>
            )}
            {costingMethod === 'uses' && (
                 <Controller name="usesPerContainer" control={control} render={({ field }) => (<div className="space-y-2"><Label htmlFor="estimated-uses">Est. Uses Per Container</Label><Input id="estimated-uses" type="number" placeholder="e.g., 100 wipes" {...field} /></div>)}/>
            )}
          </div>
    );
};

export const AddOverheadDialog = ({
  open,
  onOpenChange,
  categories,
  onNewCategory,
  onOverheadAdded,
  locations,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: string[];
  onNewCategory: (category: string) => void;
  onOverheadAdded: (overhead: InventoryItem) => void;
  locations: Location[];
}) => {
  const isMobile = useIsMobile();
  const methods = useForm<OverheadFormData>({
    resolver: zodResolver(overheadSchema),
    defaultValues: {
      costingMethod: 'uses',
    }
  });

  const { handleSubmit, watch, reset } = methods;
  const costingMethod = watch('costingMethod');

  const handleSave = (data: OverheadFormData) => {
    const newOverhead: InventoryItem = {
      id: `ovhd-${Date.now()}`,
      name: data.name,
      type: 'overhead',
      category: data.category,
      totalStock: data.initialStock,
      costPerUnit: data.purchaseCost / data.initialStock,
      supplier: data.supplier || '',
      primaryLocationId: data.primaryLocationId,
      costingMethod: data.costingMethod,
      size: data.containerSize,
      unit: data.containerUnit as any,
      estimatedUses: data.usesPerContainer,
      batches: [{
        id: `batch-${Date.now()}`,
        stock: data.initialStock,
        costPerUnit: data.purchaseCost / data.initialStock,
        receivedDate: data.purchaseDate.toISOString(),
      }],
    };
    onOverheadAdded(newOverhead);
    onOpenChange(false);
  };
  
  const handleOpenChange = (isOpen: boolean) => {
    onOpenChange(isOpen);
    if (!isOpen) {
      reset();
    }
  };
  
  const formId = "add-overhead-form";
  const title = "Add Overhead Supply";
  const description = "Log consumable supplies not directly tied to services.";

  const formContent = <OverheadFormContent categories={categories} onNewCategory={onNewCategory} locations={locations} costingMethod={costingMethod} />;

  const DialogContainer = isMobile ? Sheet : Dialog;
  const DialogContentContainer = isMobile ? SheetContent : DialogContent;

  return (
    <FormProvider {...methods}>
      <DialogContainer open={open} onOpenChange={handleOpenChange}>
        <DialogContentContainer
          className={
            isMobile
              ? "h-[90dvh] flex flex-col"
              : "sm:max-w-lg"
          }
          side="bottom"
        >
            <DialogHeader>
                <DialogTitle>{title}</DialogTitle>
                <DialogDescription>{description}</DialogDescription>
            </DialogHeader>
            <div className="flex-1 min-h-0 overflow-y-auto -mx-6 px-6">
                <form id={formId} onSubmit={handleSubmit(handleSave)} className="py-4">
                    {formContent}
                </form>
            </div>
            <DialogFooter>
                <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button type="submit" form={formId}>Save Item</Button>
            </DialogFooter>
        </DialogContentContainer>
      </DialogContainer>
    </FormProvider>
  );
};
