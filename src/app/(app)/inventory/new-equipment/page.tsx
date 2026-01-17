
'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppHeader } from '@/components/shared/AppHeader';
import Link from 'next/link';
import { ArrowLeft, PlusCircle, DollarSign, Calendar as CalendarIcon } from 'lucide-react';
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
import { useForm, Controller, FormProvider } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { type InventoryItem, type Location } from '@/lib/data';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ImageUpload } from '@/components/shared/ImageUpload';
import { useToast } from '@/hooks/use-toast';
import { useInventory } from '@/context/InventoryContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';

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

export default function NewEquipmentPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { onEquipmentAdded, equipmentCategories, onNewCategory, locations } = useInventory();
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');

  const methods = useForm<EquipmentFormData>({
    resolver: zodResolver(equipmentSchema),
  });

  const { control, handleSubmit, setValue } = methods;

  const handleAddNewCategory = () => {
    if (newCategoryName.trim()) {
      onNewCategory(newCategoryName.trim());
      setValue('category', newCategoryName.trim());
      setIsAddingCategory(false);
      setNewCategoryName('');
    }
  };

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
    toast({
        title: "Equipment Added!",
        description: `${newEquipment.name} has been added to your inventory.`
    });
    router.push('/inventory');
  };

  return (
    <div className="flex min-h-screen w-full flex-col bg-muted/40">
      <AppHeader title="Add New Equipment" />
      <main className="flex-1 p-4 md:p-8">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between gap-4 mb-8">
            <Button variant="outline" asChild>
              <Link href="/inventory"><ArrowLeft className="mr-2 h-4 w-4" /> Back to Inventory</Link>
            </Button>
          </div>
          <FormProvider {...methods}>
            <form onSubmit={handleSubmit(handleSave)}>
              <Card>
                <CardHeader>
                    <CardTitle>Add New Equipment</CardTitle>
                    <CardDescription>Log a new capital asset like a chair, station, or electronic device.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <Controller name="name" control={control} render={({ field }) => ( <div className="space-y-2"> <Label htmlFor="equipment-name">Equipment Name</Label> <Input id="equipment-name" placeholder="e.g., Hydraulic Styling Chair" {...field} /> {methods.formState.errors.name && <p className="text-sm text-destructive">{methods.formState.errors.name.message}</p>} </div> )}/>
                    <Controller name="category" control={control} render={({ field }) => ( <div className="space-y-2"> <Label htmlFor="category">Category</Label> {isAddingCategory ? ( <div className="flex gap-2"> <Input placeholder="New category..." value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} /> <Button onClick={handleAddNewCategory} type="button">Add</Button> </div> ) : ( <div className="flex gap-2"> <Select onValueChange={field.onChange} value={field.value}> <SelectTrigger> <SelectValue placeholder="Select category" /> </SelectTrigger> <SelectContent> {equipmentCategories.map(cat => ( <SelectItem key={cat} value={cat}>{cat}</SelectItem> ))} </SelectContent> </Select> <Button variant="outline" size="icon" onClick={() => setIsAddingCategory(true)} type="button"> <PlusCircle className="h-4 w-4" /> </Button> </div> )} {methods.formState.errors.category && <p className="text-sm text-destructive">{methods.formState.errors.category.message}</p>} </div> )}/>
                    <Controller name="purchaseCost" control={control} render={({ field }) => ( <div className="space-y-2"> <Label htmlFor="purchase-cost">Total Purchase Cost</Label> <div className="relative"> <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /> <Input id="purchase-cost" type="number" placeholder="0.00" className="pl-8" {...field} /> </div> {methods.formState.errors.purchaseCost && <p className="text-sm text-destructive">{methods.formState.errors.purchaseCost.message}</p>} </div> )}/>
                    <Controller name="lifespanYears" control={control} render={({ field }) => ( <div className="space-y-2"> <Label htmlFor="lifespan">Estimated Lifespan (Years)</Label> <Input id="lifespan" type="number" placeholder="e.g., 5" {...field} /> {methods.formState.errors.lifespanYears && <p className="text-sm text-destructive">{methods.formState.errors.lifespanYears.message}</p>} </div> )}/>
                    <Controller name="purchaseDate" control={control} render={({ field }) => ( <div className="space-y-2"> <Label htmlFor="purchase-date">Purchase Date</Label> <Popover> <PopoverTrigger asChild> <Button variant={"outline"} className={cn( "w-full justify-start text-left font-normal", !field.value && "text-muted-foreground" )}> <CalendarIcon className="mr-2 h-4 w-4" /> {field.value ? format(field.value, "PPP") : <span>Pick a date</span>} </Button> </PopoverTrigger> <PopoverContent className="w-auto p-0"> <Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus /> </PopoverContent> </Popover> {methods.formState.errors.purchaseDate && <p className="text-sm text-destructive">{methods.formState.errors.purchaseDate.message}</p>} </div> )}/>
                    <Controller name="primaryLocationId" control={control} render={({ field }) => ( <div className="space-y-2"> <Label htmlFor="location">Storage Location</Label> <Select onValueChange={field.onChange} value={field.value}> <SelectTrigger id="location"> <SelectValue placeholder="Select a location" /> </SelectTrigger> <SelectContent> {locations.map(loc => <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>)} </SelectContent> </Select> </div> )}/>
                    <Controller name="imageUrl" control={control} render={({ field }) => ( <div className="space-y-2"> <Label>Equipment Image</Label> <ImageUpload onImageUploaded={field.onChange} /> </div> )}/>
                </CardContent>
                <CardFooter>
                    <div className="flex justify-end w-full gap-2">
                        <Button variant="outline" onClick={() => router.push('/inventory')} type="button">Cancel</Button>
                        <Button type="submit">Save Equipment</Button>
                    </div>
                </CardFooter>
              </Card>
            </form>
          </FormProvider>
        </div>
      </main>
    </div>
  );
}
