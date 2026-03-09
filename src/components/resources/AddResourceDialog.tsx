
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
import { useForm, Controller, FormProvider } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import type { Resource, InventoryItem } from '@/lib/data';
import { Building, HardHat, Sparkles, Check, ArrowRight, MapPin, Users, Hammer, ListChecks, ShieldAlert, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '../ui/scroll-area';
import { Badge } from '../ui/badge';
import { Separator } from '../ui/separator';
import { Switch } from '../ui/switch';
import { Textarea } from '../ui/textarea';

const resourceSchema = z.object({
  name: z.string().min(1, 'Resource name is required'),
  type: z.enum(['room', 'equipment']),
  capacity: z.coerce.number().min(1, 'Capacity must be at least 1').default(1),
  inventoryItemId: z.string().optional(),
  amenities: z.string().optional(),
  isOutOfService: z.boolean().default(false),
  maintenanceNotes: z.string().optional(),
}).refine(data => data.type !== 'equipment' || !!data.inventoryItemId, {
    message: "Please select an inventory item for equipment.",
    path: ["inventoryItemId"],
});

type ResourceFormData = z.infer<typeof resourceSchema>;

const SectionHeader = ({ icon: Icon, title, step }: { icon: any, title: string, step: number | string }) => (
    <div className="flex items-center gap-4 mb-6">
        <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shadow-inner border border-primary/20 shrink-0">
            <Icon className="w-5 h-5" />
        </div>
        <div className="space-y-0.5 text-left">
            <p className="text-[9px] font-black uppercase tracking-widest text-primary/60">Module {step}</p>
            <h3 className="text-xl font-black uppercase tracking-tighter text-slate-900">{title}</h3>
        </div>
    </div>
);

interface AddResourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (resourceData: Omit<Resource, 'id'>) => void;
  equipmentInventory: InventoryItem[];
}

export const AddResourceDialog: React.FC<AddResourceDialogProps> = ({
  open,
  onOpenChange,
  onSave,
  equipmentInventory
}) => {
  const isMobile = useIsMobile();
  const methods = useForm<ResourceFormData>({
    resolver: zodResolver(resourceSchema),
    defaultValues: {
      type: 'room',
      capacity: 1,
      isOutOfService: false,
    },
  });

  const { control, handleSubmit, register, watch, reset, setValue, formState: { errors } } = methods;

  const resourceType = watch('type');
  const selectedInventoryItemId = watch('inventoryItemId');

  useEffect(() => {
    if (selectedInventoryItemId) {
        const item = equipmentInventory.find(i => i.id === selectedInventoryItemId);
        if (item) {
            setValue('name', item.name, { shouldValidate: true });
        }
    }
  }, [selectedInventoryItemId, equipmentInventory, setValue]);

  const handleSave = (data: ResourceFormData) => {
    const resourceToSave: Omit<Resource, 'id'> = {
      name: data.name,
      type: data.type,
      capacity: data.capacity,
      isOutOfService: data.isOutOfService,
      maintenanceNotes: data.maintenanceNotes,
      amenities: data.amenities ? data.amenities.split(',').map(s => s.trim()).filter(Boolean) : [],
    };

    if (data.type === 'equipment' && data.inventoryItemId) {
      resourceToSave.inventoryItemId = data.inventoryItemId;
    }
    
    onSave(resourceToSave);
    onOpenChange(false);
  };
  
  useEffect(() => {
    if (open) {
      reset({ type: 'room', name: '', capacity: 1, inventoryItemId: undefined, isOutOfService: false, amenities: '', maintenanceNotes: '' });
    }
  }, [open, reset]);

  const formBody = (
    <div className="space-y-12 text-left">
        <div className="space-y-8">
            <SectionHeader icon={MapPin} title="Operational Logic" step={1} />
            <Controller
                name="type"
                control={control}
                render={({ field }) => (
                    <div className="space-y-3">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Classification</Label>
                        <RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 gap-3">
                            <label htmlFor="room-mode" className="cursor-pointer">
                                <div className={cn(
                                    "flex flex-col items-center justify-center p-6 rounded-[2rem] border-2 transition-all h-full",
                                    field.value === 'room' ? "border-primary bg-primary/5 shadow-lg" : "border-border bg-background hover:border-primary/20"
                                )}>
                                    <Building className={cn("mb-2 h-8 w-8", field.value === 'room' ? "text-primary" : "text-muted-foreground opacity-40")} />
                                    <span className="text-[10px] font-black uppercase tracking-widest">Environment</span>
                                    <RadioGroupItem value="room" id="room-mode" className="sr-only" />
                                </div>
                            </label>
                            <label htmlFor="equipment-mode" className="cursor-pointer">
                                <div className={cn(
                                    "flex flex-col items-center justify-center p-6 rounded-[2rem] border-2 transition-all h-full",
                                    field.value === 'equipment' ? "border-primary bg-primary/5 shadow-lg" : "border-border bg-background hover:border-primary/20"
                                )}>
                                    <HardHat className={cn("mb-2 h-8 w-8", field.value === 'equipment' ? "text-primary" : "text-muted-foreground opacity-40")} />
                                    <span className="text-[10px] font-black uppercase tracking-widest">Hardware</span>
                                    <RadioGroupItem value="equipment" id="equipment-mode" className="sr-only" />
                                </div>
                            </label>
                        </RadioGroup>
                    </div>
                )}
            />
        </div>

        <div className="space-y-8 pt-10 border-t border-dashed">
            <SectionHeader icon={Users} title="Unit Capacity" step={2} />
            {resourceType === 'equipment' ? (
                <div className="space-y-6">
                    <div className="space-y-3">
                        <Label htmlFor="inventory-item" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Asset Reference</Label>
                        <Controller
                            name="inventoryItemId"
                            control={control}
                            render={({ field }) => (
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <SelectTrigger id="inventory-item" className="h-14 rounded-2xl border-2 font-black uppercase text-xs shadow-inner bg-muted/5">
                                        <SelectValue placeholder="SELECT HARDWARE..." />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-xl border-2 shadow-2xl">
                                        {equipmentInventory.map(item => <SelectItem key={item.id} value={item.id} className="font-bold uppercase text-[10px] tracking-widest">{item.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            )}
                        />
                        {errors.inventoryItemId && <p className="text-[10px] font-black text-destructive uppercase ml-1">{errors.inventoryItemId.message}</p>}
                    </div>
                </div>
            ) : (
                <div className="space-y-3">
                    <Label htmlFor="resource-name" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Unit Identity</Label>
                    <Input id="resource-name" {...register('name')} placeholder="e.g., STATION 01 / TREATMENT ROOM" className="h-14 rounded-2xl border-2 font-black uppercase text-lg tracking-tight shadow-inner" />
                    {errors.name && <p className="text-[10px] font-black text-destructive uppercase ml-1">{errors.name.message}</p>}
                </div>
            )}
            
            <div className="space-y-3">
                <Label htmlFor="capacity" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Simultaneous Occupancy</Label>
                <div className="relative">
                    <Users className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary opacity-40" />
                    <Input id="capacity" type="number" {...register('capacity')} className="h-14 pl-12 rounded-2xl border-2 font-black text-xl shadow-inner bg-muted/5 text-center" />
                </div>
                {errors.capacity && <p className="text-[10px] font-black text-destructive uppercase ml-1 text-center">{errors.capacity.message}</p>}
            </div>
        </div>

        <div className="space-y-8 pt-10 border-t border-dashed">
            <SectionHeader icon={ListChecks} title="Amenities & Status" step={3} />
            <div className="space-y-6">
                <div className="space-y-2">
                    <Label htmlFor="amenities" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Zone Features (Amenities)</Label>
                    <Input id="amenities" {...register('amenities')} placeholder="e.g., Natural Light, Sink, Power" className="h-12 rounded-xl border-2 font-bold uppercase text-xs" />
                    <p className="text-[8px] font-black uppercase text-muted-foreground opacity-40 ml-1">Comma separated list</p>
                </div>

                <div className="flex items-center justify-between p-6 rounded-[2rem] border-4 border-destructive/10 bg-destructive/5 shadow-inner transition-all">
                    <div className="space-y-1">
                        <Label htmlFor="out-of-service" className="text-base font-black uppercase tracking-tight text-destructive flex items-center gap-2">
                            <ShieldAlert className="w-4 h-4" /> Out of Service
                        </Label>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">Halt all scheduling for this unit</p>
                    </div>
                    <Controller name="isOutOfService" control={control} render={({ field }) => (
                        <Switch id="out-of-service" checked={field.value} onCheckedChange={field.onChange} className="scale-125 data-[state=checked]:bg-destructive" />
                    )}/>
                </div>

                <div className="space-y-2">
                    <Label htmlFor="maint-notes" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Maintenance Log</Label>
                    <Textarea id="maint-notes" {...register('maintenanceNotes')} placeholder="Internal notes regarding unit condition..." className="rounded-2xl border-2 bg-muted/5 min-h-[100px] focus-visible:ring-primary/20" />
                </div>
            </div>
        </div>
    </div>
  );

  const DialogContainer = isMobile ? Sheet : Dialog;
  const ContentComponent = isMobile ? SheetContent : DialogContent;

  return (
    <DialogContainer open={open} onOpenChange={onOpenChange}>
      <ContentComponent side={isMobile ? "bottom" : "right"} className={cn("p-0 border-none bg-background flex flex-col shadow-3xl overflow-hidden", isMobile ? "h-[92dvh] rounded-t-[3rem]" : "sm:max-w-xl max-h-[90dvh]")}>
        <FormProvider {...methods}>
            <form onSubmit={handleSubmit(handleSave)} className="flex flex-col h-full overflow-hidden">
                <SheetHeader className={cn("p-8 pb-6 border-b bg-muted/5 flex-shrink-0 text-left", isMobile && "p-6")}>
                    <div className="flex items-center gap-3 mb-2">
                        <Sparkles className="w-5 h-5 text-primary" />
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Strategic Intake</span>
                    </div>
                    <SheetTitle className="text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">Register Unit</SheetTitle>
                    <SheetDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">Integrate a physical unit into the studio planner.</SheetDescription>
                </SheetHeader>

                <ScrollArea className="flex-1">
                    <div className={cn("p-8", isMobile && "p-6")}>
                        {formBody}
                    </div>
                </ScrollArea>

                <SheetFooter className="p-8 pt-4 border-t bg-background flex-shrink-0">
                    <div className="grid grid-cols-2 gap-3 w-full">
                        <Button variant="ghost" onClick={() => onOpenChange(false)} type="button" className="h-12 font-black uppercase tracking-tighter text-[10px] text-slate-400">Cancel</Button>
                        <Button type="submit" className="h-12 rounded-[2rem] font-black uppercase tracking-widest text-[10px] shadow-2xl shadow-primary/30 active:scale-95 transition-all group">Commit Record <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1"/></Button>
                    </div>
                </SheetFooter>
            </form>
        </FormProvider>
      </ContentComponent>
    </DialogContainer>
  );
};
