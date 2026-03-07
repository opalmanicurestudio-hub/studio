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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
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
import { Calendar as CalendarIcon, PlusCircle, Hammer, Sparkles, Edit, DollarSign, Clock, Truck, Tag, Building, ArrowRight } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ScrollArea } from '../ui/scroll-area';
import { useIsMobile } from '@/hooks/use-mobile';

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

const SectionHeader = ({ icon: Icon, title }: { icon: any, title: string }) => (
    <div className="flex items-center gap-4 mb-6">
        <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shadow-inner border border-primary/20">
            <Icon className="w-5 h-5" />
        </div>
        <div className="space-y-0.5">
            <p className="text-[9px] font-black uppercase tracking-widest text-primary/60">Module Edit</p>
            <h3 className="text-xl font-black uppercase tracking-tighter text-slate-900">{title}</h3>
        </div>
    </div>
);

export const EditEquipmentDialog: React.FC<any> = ({
  open, onOpenChange, equipment, onEquipmentUpdated, equipmentCategories, onNewCategory, locations,
}) => {
  const isMobile = useIsMobile();
  const methods = useForm<EditEquipmentFormData>({ resolver: zodResolver(editEquipmentSchema) });
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');

  useEffect(() => {
    if (equipment && open) {
      methods.reset({
        ...equipment, purchaseCost: equipment.costPerUnit, purchaseDate: new Date(equipment.batches[0].receivedDate), lifespanYears: equipment.lifespanYears, supplier: equipment.supplier, supplierUrl: equipment.supplierUrl, primaryLocationId: equipment.primaryLocationId, imageUrl: equipment.imageUrl, sku: equipment.sku,
      });
    }
  }, [equipment, open, methods]);

  const onSubmit = (data: EditEquipmentFormData) => {
    const updatedEquipment: InventoryItem = {
      ...equipment, ...data, costPerUnit: data.purchaseCost, lifespanYears: data.lifespanYears, supplier: data.supplier || '', batches: [{ ...equipment.batches[0], costPerUnit: data.purchaseCost, receivedDate: data.purchaseDate.toISOString() }],
    };
    onEquipmentUpdated(updatedEquipment);
  };
  
  const handleAddNewCategory = () => {
    if (newCategoryName.trim()) { onNewCategory(newCategoryName.trim()); methods.setValue('category', newCategoryName.trim()); setIsAddingCategory(false); setNewCategoryName(''); }
  };

  const formBody = (
    <FormProvider {...methods}>
      <form id={`edit-equipment-form-${equipment.id}`} onSubmit={methods.handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
        <DialogHeader className={cn("flex-shrink-0 text-left border-b bg-muted/5", isMobile ? "p-6" : "p-8 pb-6")}>
          <div className="flex items-center gap-3 mb-2">
            <Edit className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Strategic Refinement</span>
          </div>
          <DialogTitle className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">Modify Asset Record</DialogTitle>
          <DialogDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">Refining record ID: {equipment.id.slice(-6).toUpperCase()}</DialogDescription>
        </DialogHeader>
        <ScrollArea className="flex-1">
            <div className={cn("pb-32 space-y-10", isMobile ? "p-6" : "p-8")}>
                <div className="space-y-8">
                    <SectionHeader icon={Hammer} title="Identity & Category" />
                    <div className="space-y-6">
                        <div className="space-y-2">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Asset Label</Label>
                            <Input {...methods.register('name')} className="h-14 rounded-2xl border-2 font-black uppercase text-lg tracking-tight" />
                        </div>
                        <div className="space-y-2">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Department</Label>
                            {isAddingCategory ? (
                                <div className="flex gap-2">
                                    <Input value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} className="h-12 rounded-xl border-2 font-bold uppercase text-xs" />
                                    <Button onClick={handleAddNewCategory} type="button" className="h-12 w-12 rounded-xl"><Check className="h-5 w-5"/></Button>
                                </div>
                            ) : (
                                <div className="flex gap-2">
                                    <Controller name="category" control={methods.control} render={({ field }) => (
                                        <Select onValueChange={field.onChange} value={field.value}><SelectTrigger className="h-12 rounded-xl border-2 font-bold uppercase text-xs shadow-inner bg-muted/5"><SelectValue /></SelectTrigger><SelectContent className="rounded-xl border-2 shadow-2xl">{equipmentCategories.map(cat => <SelectItem key={cat} value={cat} className="font-bold uppercase text-[10px] tracking-widest">{cat}</SelectItem>)}</SelectContent></Select>
                                    )}/>
                                    <Button variant="outline" size="icon" onClick={() => setIsAddingCategory(true)} type="button" className="h-12 w-12 rounded-xl border-2"><PlusCircle className="h-5 w-5"/></Button>
                                </div>
                            )}
                        </div>
                        <div className="space-y-2">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Asset visual</Label>
                            <Controller name="imageUrl" control={methods.control} render={({ field }) => ( <ImageUpload onImageUploaded={field.onChange} initialImage={field.value} /> )}/>
                        </div>
                    </div>
                </div>

                <div className="space-y-8 pt-10 border-t border-dashed">
                    <SectionHeader icon={DollarSign} title="Capital Re-evaluation" />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                        <div className="space-y-6">
                            <div className="space-y-2">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Purchase Cost</Label>
                                <div className="relative"><DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary"/><Input type="number" {...methods.register('purchaseCost')} className="h-14 pl-10 rounded-2xl border-2 font-black text-xl font-mono text-primary shadow-inner" /></div>
                            </div>
                            <div className="space-y-2">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Lifecycle (Years)</Label>
                                <Input type="number" {...methods.register('lifespanYears')} className="h-14 rounded-2xl border-2 font-black text-xl" />
                            </div>
                        </div>
                        <div className="space-y-6">
                            <div className="space-y-2">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Investment Date</Label>
                                <Controller name="purchaseDate" control={methods.control} render={({ field }) => (
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <Button variant="outline" className="w-full h-14 rounded-2xl border-2 font-bold justify-start px-4 text-sm bg-muted/5"><CalendarIcon className="mr-2 h-5 w-5 opacity-40" /> {field.value ? format(field.value, 'MMM d, yyyy') : 'Pick a date'}</Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-auto p-0 rounded-3xl overflow-hidden shadow-3xl border-4"><Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus /></PopoverContent>
                                    </Popover>
                                )}/>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="space-y-8 pt-10 border-t border-dashed">
                    <SectionHeader icon={Truck} title="Logistics Refinement" />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                        <div className="space-y-6">
                            <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Supplier</Label><Input {...methods.register('supplier')} className="h-11 rounded-xl border-2 font-bold" /></div>
                            <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Asset SKU</Label><Input {...methods.register('sku')} className="h-11 rounded-xl border-2 font-mono font-black" /></div>
                        </div>
                        <div className="space-y-6">
                            <div className="space-y-1.5">
                                <Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Primary Zone</Label>
                                <div className="flex gap-2">
                                    <Controller name="primaryLocationId" control={methods.control} render={({ field }) => (
                                        <Select onValueChange={field.onChange} value={field.value}>
                                            <SelectTrigger className="h-11 rounded-xl border-2 font-bold uppercase text-[10px] tracking-widest flex-1 bg-muted/5 shadow-inner"><SelectValue /></SelectTrigger>
                                            <SelectContent className="rounded-xl border-2 shadow-2xl">{locations.map(loc => (<SelectItem key={loc.id} value={loc.id} className="font-bold uppercase text-[9px] tracking-widest">{loc.name}</SelectItem>))}</SelectContent>
                                        </Select>
                                    )}/>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </ScrollArea>
        <DialogFooter className={cn("border-t bg-background flex-shrink-0 shadow-2xl", isMobile ? "p-4" : "p-6 sm:p-8 pt-4")}>
          <div className='flex w-full gap-4'>
            <Button variant="outline" onClick={() => onOpenChange(false)} type="button" className="flex-1 h-12 md:h-16 rounded-3xl font-black uppercase tracking-widest text-[10px] md:text-xl border-2">Cancel</Button>
            <Button type="submit" className="flex-[1.5] h-12 md:h-16 font-black uppercase tracking-widest text-[10px] md:text-xl rounded-[2rem] shadow-2xl shadow-primary/30">Commit Changes</Button>
          </div>
        </DialogFooter>
      </form>
    </FormProvider>
  );

  const DialogContainer = isMobile ? Sheet : Dialog;
  return (
    <DialogContainer open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("p-0 border-none bg-background flex flex-col shadow-3xl overflow-hidden", isMobile ? "h-[92dvh] rounded-t-[2.5rem]" : "sm:max-w-4xl max-h-[90dvh]")} side="right">
        {formBody}
      </DialogContent>
    </DialogContainer>
  );
};
