'use client';

import React, { useState, useEffect } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { PlusCircle, Upload, Save, Check, Box, Building, Store, ClipboardList, LucideIcon, MapPin, Sparkles, X, Activity, ShieldCheck, ThermometerSnowflake, Sun, Wind, Droplets, Edit, ArrowRight } from 'lucide-react';
import { useForm, Controller, FormProvider, useFormContext } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { cn } from '@/lib/utils';
import { type Location, type LocationType } from '@/lib/data';
import { ScrollArea } from '../ui/scroll-area';
import { useIsMobile } from '@/hooks/use-mobile';

const locationSchema = z.object({
  name: z.string().min(1, { message: 'Location label is required.' }),
  locationTypeId: z.string().min(1, { message: 'Zone type is required.' }),
  description: z.string().optional(),
  refrigerated: z.boolean().optional(),
  noSunlight: z.boolean().optional(),
  ventilated: z.boolean().optional(),
  humidityControlled: z.boolean().optional(),
  customNeeds: z.string().optional(),
});

type LocationFormData = z.infer<typeof locationSchema>;

const iconMap: { [key: string]: { component: LucideIcon, label: string } } = {
    Box: { component: Box, label: 'Box' },
    Building: { component: Building, label: 'Building' },
    Store: { component: Store, label: 'Store' },
    ClipboardList: { component: ClipboardList, label: 'Clipboard' },
};

const SectionHeader = ({ icon: Icon, title }: { icon: any, title: string }) => (
    <div className="flex items-center gap-4 mb-6">
        <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shadow-inner border border-primary/20 shrink-0">
            <Icon className="w-5 h-5" />
        </div>
        <div className="space-y-0.5 text-left">
            <p className="text-[9px] font-black uppercase tracking-widest text-primary/60">Module Refinement</p>
            <h3 className="text-xl font-black uppercase tracking-tighter text-slate-900">{title}</h3>
        </div>
    </div>
);

export const EditLocationDialog = ({
  open,
  onOpenChange,
  location,
  onSave,
  locationTypes,
  onAddNewLocationType,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  location: Location;
  onSave: (data: Location) => void;
  locationTypes: LocationType[];
  onAddNewLocationType: (name: string, icon: string) => LocationType;
}) => {
  const isMobile = useIsMobile();
  const [isAddingType, setIsAddingType] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');
  const [newTypeIcon, setNewTypeIcon] = useState('Box');

  const methods = useForm<LocationFormData>({
    resolver: zodResolver(locationSchema),
  });

  const { control, handleSubmit, setValue, reset, formState: { errors } } = methods;

  useEffect(() => {
    if (location && open) {
      reset({
        name: location.name,
        locationTypeId: location.locationTypeId,
        description: location.description || '',
        customNeeds: location.customNeeds || '',
        refrigerated: location.environmentalNeeds?.includes('Refrigerated'),
        noSunlight: location.environmentalNeeds?.includes('Keep out of sunlight'),
        ventilated: location.environmentalNeeds?.includes('Ventilated'),
        humidityControlled: location.environmentalNeeds?.includes('Humidity Controlled'),
      });
    }
  }, [location, open, reset]);

  const handleSave = (data: LocationFormData) => {
    const environmentalNeeds: string[] = [];
    if (data.refrigerated) environmentalNeeds.push('Refrigerated');
    if (data.noSunlight) environmentalNeeds.push('Keep out of sunlight');
    if (data.ventilated) environmentalNeeds.push('Ventilated');
    if (data.humidityControlled) environmentalNeeds.push('Humidity Controlled');
    
    const finalData: Location = {
        id: location.id,
        name: data.name,
        locationTypeId: data.locationTypeId,
        description: data.description,
        customNeeds: data.customNeeds,
        environmentalNeeds,
    };
    onSave(finalData);
    handleClose();
  };
  
  const handleAddNewType = () => {
    if (newTypeName.trim()) {
        const newType = onAddNewLocationType(newTypeName.trim(), newTypeIcon);
        setValue('locationTypeId', newType.id, { shouldValidate: true });
        setNewTypeName('');
        setIsAddingType(false);
    }
  };

  const handleClose = () => {
    setIsAddingType(false);
    onOpenChange(false);
  }

  const formBody = (
    <FormProvider {...methods}>
        <form id={`edit-location-strategic-form-${location.id}`} onSubmit={handleSubmit(handleSave)} className="flex flex-col flex-1 min-h-0">
            <DialogHeader className={cn("flex-shrink-0 text-left border-b bg-muted/5", isMobile ? "p-6" : "p-8 pb-6")}>
                <div className="flex items-center gap-3 mb-2">
                    <Edit className="w-5 h-5 text-primary" />
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Architecture Refinement</span>
                </div>
                <DialogTitle className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">Modify Zone Detail</DialogTitle>
                <DialogDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">Refining record ID: {location.id.slice(-6).toUpperCase()}</DialogDescription>
            </DialogHeader>
            
            <ScrollArea className="flex-1">
                <div className={cn("pb-32 space-y-12", isMobile ? "p-6" : "p-8")}>
                    <div className="space-y-10">
                        <SectionHeader icon={MapPin} title="Identity & Category" />
                        <div className="space-y-6 text-left">
                            <div className="space-y-2">
                                <Label htmlFor="location-name-edit" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Zone Label</Label>
                                <Input id="location-name-edit" placeholder="e.g., BACK ROOM SHELF A" {...control.register('name')} className="h-14 rounded-2xl border-2 font-black uppercase text-lg tracking-tight shadow-inner bg-muted/5" />
                                {errors.name && <p className="text-[10px] font-black text-destructive uppercase ml-1">{errors.name.message}</p>}
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="location-type-edit" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Unit Classification</Label>
                                {isAddingType ? (
                                    <div className="p-6 rounded-[2rem] border-4 border-primary/10 bg-primary/[0.02] space-y-6 shadow-inner animate-in slide-in-from-top-2">
                                        <div className="space-y-2">
                                            <Label className="text-[9px] font-black uppercase text-primary tracking-widest">Type Name</Label>
                                            <Input 
                                                placeholder="e.g., DRAWER UNIT" 
                                                value={newTypeName}
                                                onChange={(e) => setNewTypeName(e.target.value)}
                                                className="h-11 rounded-xl border-2 font-bold uppercase text-sm bg-white"
                                            />
                                        </div>
                                        <div className="space-y-3">
                                            <Label className="text-[9px] font-black uppercase text-primary tracking-widest">Icon Glyph</Label>
                                            <RadioGroup value={newTypeIcon} onValueChange={setNewTypeIcon} className="grid grid-cols-4 gap-2">
                                                {Object.entries(iconMap).map(([iconKey, { component: Icon, label }]) => (
                                                    <div key={iconKey}>
                                                        <RadioGroupItem value={iconKey} id={`edit-type-${iconKey}`} className="peer sr-only" />
                                                        <Label htmlFor={`edit-type-${iconKey}`} className={cn("flex flex-col items-center justify-center rounded-xl border-2 border-muted bg-white p-3 text-[10px] font-black uppercase tracking-tighter hover:bg-primary/[0.03] peer-data-[state=checked]:border-primary peer-data-[state=checked]:text-primary transition-all cursor-pointer h-16 shadow-sm")}>
                                                            <Icon className="w-5 h-5 mb-1" />
                                                            {label}
                                                        </Label>
                                                    </div>
                                                ))}
                                            </RadioGroup>
                                        </div>
                                        <div className="flex gap-3 pt-2">
                                            <Button onClick={handleAddNewType} type="button" className="flex-1 h-11 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-xl">Define Type</Button>
                                            <Button variant="ghost" onClick={() => setIsAddingType(false)} type="button" className="h-11 rounded-xl font-bold uppercase text-[10px] text-slate-400">Cancel</Button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex gap-3">
                                        <Controller
                                            name="locationTypeId"
                                            control={control}
                                            render={({ field }) => (
                                                <Select onValueChange={field.onChange} value={field.value}>
                                                    <SelectTrigger id="location-type-edit" className="h-14 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest shadow-inner bg-muted/5 flex-1">
                                                        <SelectValue placeholder="SELECT ZONE TYPE..." />
                                                    </SelectTrigger>
                                                    <SelectContent className="rounded-xl border-2 shadow-2xl">
                                                        {locationTypes.map((type) => {
                                                            const Icon = iconMap[type.icon]?.component;
                                                            return (
                                                                <SelectItem key={type.id} value={type.id} className="font-bold uppercase text-[10px] tracking-widest">
                                                                    <div className="flex items-center gap-2">
                                                                    {Icon && <Icon className="w-3.5 h-3.5" />}
                                                                    {type.name}
                                                                    </div>
                                                                </SelectItem>
                                                            )
                                                        })}
                                                    </SelectContent>
                                                </Select>
                                            )}
                                        />
                                        <Button variant="outline" size="icon" onClick={() => setIsAddingType(true)} type="button" className="h-14 w-14 rounded-2xl border-2 shrink-0 bg-white/50">
                                            <PlusCircle className="h-6 w-6 opacity-40" />
                                        </Button>
                                    </div>
                                )}
                                {errors.locationTypeId && <p className="text-[10px] font-black text-destructive uppercase ml-1">{errors.locationTypeId.message}</p>}
                            </div>
                        </div>
                    </div>

                    <div className="space-y-10 pt-10 border-t border-dashed">
                        <SectionHeader icon={ShieldCheck} title="Governance & Logic" />
                        <div className="space-y-8 text-left">
                            <div className="space-y-4">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Environmental Thresholds</Label>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    {[
                                        { id: 'refrigerated-edit', label: 'Cold Storage', icon: ThermometerSnowflake, color: 'text-blue-500', field: 'refrigerated' },
                                        { id: 'noSunlight-edit', label: 'UV Shielded', icon: Sun, color: 'text-amber-500', field: 'noSunlight' },
                                        { id: 'ventilated-edit', label: 'Air Flow Required', icon: Wind, color: 'text-teal-500', field: 'ventilated' },
                                        { id: 'humidityControlled-edit', label: 'Humidity Monitored', icon: Droplets, color: 'text-indigo-500', field: 'humidityControlled' }
                                    ].map(spec => (
                                        <div key={spec.id} className="flex items-center justify-between p-4 rounded-2xl border-2 bg-muted/10 transition-all has-[:checked]:bg-white has-[:checked]:border-primary/20 shadow-sm">
                                            <div className="flex items-center gap-3">
                                                <div className={cn("p-2 rounded-lg bg-background shadow-inner", spec.color)}>
                                                    <spec.icon className="w-4 h-4" />
                                                </div>
                                                <Label htmlFor={spec.id} className="text-[11px] font-black uppercase tracking-tight cursor-pointer">{spec.label}</Label>
                                            </div>
                                            <Controller name={spec.field as any} control={control} render={({ field }) => (
                                                <Checkbox id={spec.id} checked={field.value} onCheckedChange={field.onChange} className="h-6 w-6 rounded-lg border-2" />
                                            )}/>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="customNeeds-edit" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Ancillary Protocol Requirements</Label>
                                <Input id="customNeeds-edit" placeholder="e.g., MUST BE STORED UPRIGHT" {...control.register('customNeeds')} className="h-12 rounded-xl border-2 font-black uppercase text-xs shadow-inner bg-muted/5" />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="location-description-edit" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Operational Description</Label>
                                <Textarea id="location-description-edit" placeholder="Specify what is typically archived in this zone..." {...control.register('description')} className="rounded-2xl border-2 bg-muted/5 min-h-[100px] focus-visible:ring-primary/20" />
                            </div>
                        </div>
                    </div>
                </div>
            </ScrollArea>

            <DialogFooter className={cn("border-t bg-background flex-shrink-0 shadow-2xl", isMobile ? "p-4" : "p-6 sm:p-8 pt-4")}>
                <div className="grid grid-cols-2 gap-3 w-full">
                    <Button variant="ghost" onClick={handleClose} type="button" className="h-12 font-black uppercase tracking-tighter text-[10px] text-slate-400">Cancel</Button>
                    <Button type="submit" className="h-12 rounded-[2rem] font-black uppercase tracking-widest text-[10px] shadow-2xl shadow-primary/30 active:scale-95 transition-all group">Commit Changes <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1"/></Button>
                </div>
            </DialogFooter>
        </form>
    </FormProvider>
  );

  const DialogContainer = isMobile ? Sheet : Dialog;
  const ContentComponent = isMobile ? SheetContent : DialogContent;

  return (
    <DialogContainer open={open} onOpenChange={handleClose}>
      <ContentComponent side={isMobile ? "bottom" : "right"} className={cn("p-0 border-none bg-background flex flex-col shadow-3xl overflow-hidden", isMobile ? "h-[92dvh] rounded-t-[3rem]" : "sm:max-w-xl max-h-[90dvh]")}>
        {formBody}
      </ContentComponent>
    </DialogContainer>
  );
};