'use client';

import React, { useState, useEffect } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { PlusCircle, Check, Box, Building, Store, ClipboardList, LucideIcon, MapPin, Sparkles, ShieldCheck, ThermometerSnowflake, Sun, Wind, Droplets, ArrowRight } from 'lucide-react';
import { useForm, Controller, FormProvider } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { cn } from '@/lib/utils';
import { type Location, type LocationType } from '@/lib/data';
import { ScrollArea } from '../ui/scroll-area';

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

const iconMap: { [key: string]: { component: LucideIcon; label: string } } = {
  Box: { component: Box, label: 'Box' },
  Building: { component: Building, label: 'Building' },
  Store: { component: Store, label: 'Store' },
  ClipboardList: { component: ClipboardList, label: 'Clipboard' },
};

const SectionHeader = ({ icon: Icon, title, step }: { icon: any; title: string; step: number | string }) => (
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

export const AddLocationDialog = ({
  open, onOpenChange, onSave, locationTypes, onAddNewLocationType,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: Omit<Location, 'id'>) => Location;
  locationTypes: LocationType[];
  onAddNewLocationType: (name: string, icon: string) => LocationType;
}) => {
  const isMobile = useIsMobile();
  const [isAddingType, setIsAddingType] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');
  const [newTypeIcon, setNewTypeIcon] = useState('Box');

  const methods = useForm<LocationFormData>({
    resolver: zodResolver(locationSchema),
    defaultValues: { name: '', locationTypeId: '', description: '', refrigerated: false, noSunlight: false, ventilated: false, humidityControlled: false, customNeeds: '' },
  });

  const { control, handleSubmit, setValue, reset, formState: { errors } } = methods;

  const handleSave = (data: LocationFormData) => {
    const environmentalNeeds: string[] = [];
    if (data.refrigerated) environmentalNeeds.push('Refrigerated');
    if (data.noSunlight) environmentalNeeds.push('Keep out of sunlight');
    if (data.ventilated) environmentalNeeds.push('Ventilated');
    if (data.humidityControlled) environmentalNeeds.push('Humidity Controlled');
    onSave({ name: data.name, locationTypeId: data.locationTypeId, description: data.description, customNeeds: data.customNeeds, environmentalNeeds });
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

  const handleClose = () => { reset(); setIsAddingType(false); onOpenChange(false); };

  const inner = (
    <FormProvider {...methods}>
      <form onSubmit={handleSubmit(handleSave)} className="h-full flex flex-col">

        <div className="flex-shrink-0 text-left border-b bg-muted/5 p-6 md:p-8 md:pb-6">
          <div className="flex items-center gap-3 mb-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Architecture Intake</span>
          </div>
          <h2 className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">Register New Zone</h2>
          <p className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">Establish a physical storage unit within the studio manifest.</p>
        </div>

        <ScrollArea className="flex-1 min-h-0">
          <div className="p-6 md:p-8 space-y-12 pb-10">

            <div className="space-y-10">
              <SectionHeader icon={MapPin} title="Identity & Category" step={1} />
              <div className="space-y-6 text-left">
                <div className="space-y-2">
                  <Label htmlFor="location-name" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Zone Label</Label>
                  <Input id="location-name" placeholder="e.g., BACK ROOM SHELF A" {...control.register('name')} className="h-14 rounded-2xl border-2 font-black uppercase text-lg tracking-tight shadow-inner bg-muted/5" />
                  {errors.name && <p className="text-[10px] font-black text-destructive uppercase ml-1">{errors.name.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Unit Classification</Label>
                  {isAddingType ? (
                    <div className="p-6 rounded-[2rem] border-4 border-primary/10 bg-primary/[0.02] space-y-6 shadow-inner animate-in slide-in-from-top-2">
                      <div className="space-y-2">
                        <Label className="text-[9px] font-black uppercase text-primary tracking-widest">Type Name</Label>
                        <Input placeholder="e.g., DRAWER UNIT" value={newTypeName} onChange={e => setNewTypeName(e.target.value)} className="h-11 rounded-xl border-2 font-bold uppercase text-sm bg-white" />
                      </div>
                      <div className="space-y-3">
                        <Label className="text-[9px] font-black uppercase text-primary tracking-widest">Icon Glyph</Label>
                        <RadioGroup value={newTypeIcon} onValueChange={setNewTypeIcon} className="grid grid-cols-4 gap-2">
                          {Object.entries(iconMap).map(([iconKey, { component: Icon, label }]) => (
                            <div key={iconKey}>
                              <RadioGroupItem value={iconKey} id={`new-type-${iconKey}`} className="peer sr-only" />
                              <Label htmlFor={`new-type-${iconKey}`} className="flex flex-col items-center justify-center rounded-xl border-2 border-muted bg-white p-3 text-[10px] font-black uppercase tracking-tighter hover:bg-primary/[0.03] peer-data-[state=checked]:border-primary peer-data-[state=checked]:text-primary transition-all cursor-pointer h-16 shadow-sm">
                                <Icon className="w-5 h-5 mb-1" />{label}
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
                      <Controller name="locationTypeId" control={control} render={({ field }) => (
                        <Select onValueChange={field.onChange} value={field.value}>
                          <SelectTrigger className="h-14 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest shadow-inner bg-muted/5 flex-1">
                            <SelectValue placeholder="SELECT ZONE TYPE..." />
                          </SelectTrigger>
                          <SelectContent className="rounded-xl border-2 shadow-2xl">
                            {locationTypes.map(type => {
                              const Icon = iconMap[type.icon]?.component;
                              return (
                                <SelectItem key={type.id} value={type.id} className="font-bold uppercase text-[10px] tracking-widest">
                                  <div className="flex items-center gap-2">{Icon && <Icon className="w-3.5 h-3.5" />}{type.name}</div>
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                      )} />
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
              <SectionHeader icon={ShieldCheck} title="Governance & Logic" step={2} />
              <div className="space-y-8 text-left">
                <div className="space-y-4">
                  <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Environmental Thresholds</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {[
                      { id: 'refrigerated', label: 'Cold Storage', icon: ThermometerSnowflake, color: 'text-blue-500' },
                      { id: 'noSunlight', label: 'UV Shielded', icon: Sun, color: 'text-amber-500' },
                      { id: 'ventilated', label: 'Air Flow Required', icon: Wind, color: 'text-teal-500' },
                      { id: 'humidityControlled', label: 'Humidity Monitored', icon: Droplets, color: 'text-indigo-500' },
                    ].map(spec => (
                      <div key={spec.id} className="flex items-center justify-between p-4 rounded-2xl border-2 bg-muted/10 transition-all has-[:checked]:bg-white has-[:checked]:border-primary/20 shadow-sm">
                        <div className="flex items-center gap-3">
                          <div className={cn('p-2 rounded-lg bg-background shadow-inner', spec.color)}>
                            <spec.icon className="w-4 h-4" />
                          </div>
                          <Label htmlFor={spec.id} className="text-[11px] font-black uppercase tracking-tight cursor-pointer">{spec.label}</Label>
                        </div>
                        <Controller name={spec.id as any} control={control} render={({ field }) => (
                          <Checkbox id={spec.id} checked={field.value} onCheckedChange={field.onChange} className="h-6 w-6 rounded-lg border-2" />
                        )} />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Ancillary Protocol Requirements</Label>
                  <Input placeholder="e.g., MUST BE STORED UPRIGHT" {...control.register('customNeeds')} className="h-12 rounded-xl border-2 font-black uppercase text-xs shadow-inner bg-muted/5" />
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Operational Description</Label>
                  <Textarea placeholder="Specify what is typically archived in this zone..." {...control.register('description')} className="rounded-2xl border-2 bg-muted/5 min-h-[100px] focus-visible:ring-primary/20" />
                </div>
              </div>
            </div>

          </div>
        </ScrollArea>

        <div className="flex-shrink-0 border-t bg-background shadow-2xl p-4 md:p-6">
          <div className="grid grid-cols-2 gap-3 w-full">
            <Button variant="ghost" onClick={handleClose} type="button" className="h-12 font-black uppercase tracking-tighter text-[10px] text-slate-400">Cancel</Button>
            <Button type="submit" className="h-12 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-2xl shadow-primary/30 active:scale-95 transition-all group">
              Establish Zone <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1" />
            </Button>
          </div>
        </div>

      </form>
    </FormProvider>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={handleClose}>
        <SheetContent side="bottom" className="h-[92dvh] rounded-t-[3rem] p-0 border-none bg-background flex flex-col overflow-hidden shadow-2xl">
          {inner}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-xl h-[90dvh] !flex flex-col !gap-0 p-0 border-4 rounded-[2.5rem] overflow-hidden shadow-2xl">
        {inner}
      </DialogContent>
    </Dialog>
  );
};