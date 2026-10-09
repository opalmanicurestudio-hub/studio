'use client';

import { useTenant } from '@/context/TenantContext';
import React, { useEffect, useState } from 'react';
import { collection } from 'firebase/firestore';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
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
import { Building, HardHat, Edit, ArrowRight, MapPin, Users, Sparkles, ShieldAlert, ListChecks } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Switch } from '../ui/switch';
import { Textarea } from '../ui/textarea';

const resourceSchema = z.object({
  name: z.string().min(1, 'Resource name is required'),
  type: z.enum(['room', 'equipment']),
  capacity: z.coerce.number().min(1, 'Capacity must be at least 1').default(1),
  inventoryItemId: z.string().optional(),
  amenities: z.string().optional(),
  isOutOfService: z.boolean().default(false),
  rentalEnabled: z.boolean().default(false),                      // rent it out by the hour / day (no provider)
  rentalHourly: z.coerce.number().min(0).optional(),
  rentalDaily: z.coerce.number().min(0).optional(),
  rentalGrace: z.coerce.number().min(0).optional(),
  rentalBlock: z.coerce.number().min(5).optional(),
  rentalMin: z.coerce.number().min(0).optional(),
  maintenanceNotes: z.string().optional(),
}).refine(data => data.type !== 'equipment' || !!data.inventoryItemId, {
    message: "Please select an inventory item for equipment.",
    path: ["inventoryItemId"],
});

type ResourceFormData = z.infer<typeof resourceSchema>;

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

interface EditResourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resource: Resource;
  onSave: (resourceData: Resource) => void;
  equipmentInventory: InventoryItem[];
}

export const EditResourceDialog: React.FC<EditResourceDialogProps> = ({
  open,
  onOpenChange,
  resource,
  onSave,
  equipmentInventory
}) => {
  const isMobile = useIsMobile();
  const methods = useForm<ResourceFormData>({
    resolver: zodResolver(resourceSchema),
  });

  const { control, handleSubmit, register, watch, reset, setValue, formState: { errors } } = methods;
  const { selectedTenant } = useTenant(); const tenantId = selectedTenant?.id || '';

  // What every booking of this room / station needs, on top of the service's own needs (e.g. a sheet set for each
  // treatment-room booking, two towels for each sauna rental). Picked from the business's kit types and linens.
  const [needs, setNeeds] = useState<{ kind: 'kit' | 'linen'; name: string; qty: number }[]>([]);
  const { firestore: fsN } = useFirebase();
  const { data: kitTypeList } = useCollection<any>(useMemoFirebase(() => (fsN && tenantId ? collection(fsN, 'tenants', tenantId, 'kitTypes') : null), [fsN, tenantId]));
  const { data: linenList } = useCollection<any>(useMemoFirebase(() => (fsN && tenantId ? collection(fsN, 'tenants', tenantId, 'linens') : null), [fsN, tenantId]));
  const resourceType = watch('type');
  const selectedInventoryItemId = watch('inventoryItemId');

  useEffect(() => {
    if (resource && open) {
      reset({
        name: resource.name,
        type: resource.type,
        capacity: resource.capacity || 1,
        inventoryItemId: resource.inventoryItemId,
        isOutOfService: !!resource.isOutOfService,
        rentalEnabled: !!(resource as any).rental?.enabled, rentalHourly: ((resource as any).rental?.hourlyCents || 0) / 100 || undefined, rentalDaily: ((resource as any).rental?.dailyCents || 0) / 100 || undefined, rentalGrace: (resource as any).rental?.graceMinutes ?? 10, rentalBlock: (resource as any).rental?.blockMinutes ?? 15, rentalMin: (resource as any).rental?.minMinutes ?? 60,
        amenities: resource.amenities?.join(', ') || '',
        maintenanceNotes: resource.maintenanceNotes || '',
      });
      setNeeds(Array.isArray((resource as any).needs) ? (resource as any).needs : []);
    }
  }, [resource, open, reset]);

  useEffect(() => {
    if (resourceType === 'equipment' && selectedInventoryItemId) {
        const item = equipmentInventory.find(i => i.id === selectedInventoryItemId);
        if (item && item.name !== watch('name')) {
            setValue('name', item.name, { shouldValidate: true });
        }
    }
  }, [selectedInventoryItemId, resourceType, equipmentInventory, setValue, watch]);

  const handleSave = (data: ResourceFormData) => {
    onSave({
      ...resource,
      name: data.name,
      type: data.type,
      capacity: data.capacity,
      isOutOfService: data.isOutOfService,
      rental: { enabled: !!data.rentalEnabled, hourlyCents: Math.round((Number(data.rentalHourly) || 0) * 100), dailyCents: Math.round((Number(data.rentalDaily) || 0) * 100), graceMinutes: Number(data.rentalGrace) || 10, blockMinutes: Number(data.rentalBlock) || 15, minMinutes: Number(data.rentalMin) || 60 },
      maintenanceNotes: data.maintenanceNotes,
      amenities: data.amenities ? data.amenities.split(',').map(s => s.trim()).filter(Boolean) : [],
      inventoryItemId: data.type === 'equipment' ? data.inventoryItemId : undefined,
      needs: needs.filter((n) => String(n.name || '').trim()).map((n) => ({ kind: n.kind, name: String(n.name).trim(), qty: Math.max(1, Math.round(Number(n.qty) || 1)) })),
    } as any);
    // Rentable → mirror into the rental engine (one space per unit) once the resource has saved.
    if (data.rentalEnabled || (resource as any)?.rental?.enabled) setTimeout(async () => { try { const { getAuth } = await import('firebase/auth'); const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
      await fetch('/api/resources/rentable', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify({ tenantId, resourceId: resource.id }) }); } catch { /* the next save retries */ } }, 1200);
    onOpenChange(false);
  };

  const formBody = (
    <div className="space-y-12 text-left">
        <div className="space-y-8">
            <SectionHeader icon={MapPin} title="Identity Refinement" />
            <Controller
                name="type"
                control={control}
                render={({ field }) => (
                    <div className="space-y-3">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Classification</Label>
                        <RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 gap-3">
                            <label htmlFor="room-edit-mode" className="cursor-pointer">
                                <div className={cn(
                                    "flex flex-col items-center justify-center p-6 rounded-[2rem] border-2 transition-all h-full",
                                    field.value === 'room' ? "border-primary bg-primary/5 shadow-md" : "border-border bg-background hover:border-primary/20"
                                )}>
                                    <Building className={cn("mb-2 h-8 w-8", field.value === 'room' ? "text-primary" : "text-muted-foreground opacity-40")} />
                                    <span className="text-[10px] font-black uppercase tracking-widest">Environment</span>
                                    <RadioGroupItem value="room" id="room-edit-mode" className="sr-only" />
                                </div>
                            </label>
                            <label htmlFor="equipment-edit-mode" className="cursor-pointer">
                                <div className={cn(
                                    "flex flex-col items-center justify-center p-6 rounded-[2rem] border-2 transition-all h-full",
                                    field.value === 'equipment' ? "border-primary bg-primary/5 shadow-md" : "border-border bg-background hover:border-primary/20"
                                )}>
                                    <HardHat className={cn("mb-2 h-8 w-8", field.value === 'equipment' ? "text-primary" : "text-muted-foreground opacity-40")} />
                                    <span className="text-[10px] font-black uppercase tracking-widest">Hardware</span>
                                    <RadioGroupItem value="equipment" id="equipment-edit-mode" className="sr-only" />
                                </div>
                            </label>
                        </RadioGroup>
                    </div>
                )}
            />
        </div>

        <div className="space-y-8 pt-10 border-t border-dashed">
            <SectionHeader icon={Users} title="Unit Parameters" />
            {resourceType === 'equipment' ? (
                <div className="space-y-6">
                    <div className="space-y-3">
                        <Label htmlFor="inventory-item-edit" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Asset Reference</Label>
                        <Controller
                            name="inventoryItemId"
                            control={control}
                            render={({ field }) => (
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <SelectTrigger id="inventory-item-edit" className="h-14 rounded-2xl border-2 font-black uppercase text-xs shadow-inner bg-muted/5">
                                        <SelectValue placeholder="SELECT HARDWARE..." />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-xl border-2 shadow-2xl">
                                        {equipmentInventory.map(item => (
                                            <SelectItem key={item.id} value={item.id} className="font-bold uppercase text-[10px] tracking-widest">{item.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        />
                        {errors.inventoryItemId && <p className="text-[10px] font-black text-destructive uppercase ml-1">{errors.inventoryItemId.message}</p>}
                    </div>
                </div>
            ) : (
                <div className="space-y-3">
                    <Label htmlFor="resource-name-edit" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Unit Identity</Label>
                    <Input id="resource-name-edit" {...register('name')} placeholder="e.g., STATION 01" className="h-14 rounded-2xl border-2 font-black uppercase text-lg tracking-tight shadow-inner" />
                    {errors.name && <p className="text-[10px] font-black text-destructive uppercase ml-1">{errors.name.message}</p>}
                </div>
            )}

            <div className="space-y-3">
                <Label htmlFor="capacity-edit" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Simultaneous Occupancy</Label>
                <div className="relative">
                    <Users className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary opacity-40" />
                    <Input id="capacity-edit" type="number" {...register('capacity')} className="h-14 pl-12 rounded-2xl border-2 font-black text-xl shadow-inner bg-muted/5 text-center" />
                </div>
                {errors.capacity && <p className="text-[10px] font-black text-destructive uppercase ml-1 text-center">{errors.capacity.message}</p>}
            </div>
        </div>

        <div className="space-y-8 pt-10 border-t border-dashed">
            <SectionHeader icon={ListChecks} title="Amenities & Status" />
            <div className="space-y-6">
                <div className="space-y-2">
                    <Label htmlFor="amenities-edit" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Zone Features (Amenities)</Label>
                    <Input id="amenities-edit" {...register('amenities')} placeholder="e.g., Natural Light, Sink, Power" className="h-12 rounded-xl border-2 font-bold uppercase text-xs" />
                    <p className="text-[8px] font-black uppercase text-muted-foreground opacity-40 ml-1">Comma separated list</p>
                </div>

                <div className="space-y-2 rounded-2xl border p-4">
                    <p className="text-[14px] font-[700]">Every booking here needs</p>
                    <p className="text-[12px] text-muted-foreground">Added to whatever the service needs — for appointments in this {resourceType === 'equipment' ? 'equipment' : 'room or station'} and for rentals of it. Housekeeping sets one aside for each booking.</p>
                    {needs.map((n, i) => { const opts: string[] = n.kind === 'kit' ? (kitTypeList || []).map((t: any) => String(t.name)) : (linenList || []).map((l: any) => String(l.name));
                      return (
                      <div key={i} className="flex flex-wrap items-center gap-2">
                        <select value={n.kind} onChange={(e) => setNeeds((xs) => xs.map((x, j) => (j === i ? { ...x, kind: e.target.value as 'kit' | 'linen', name: '' } : x)))} aria-label="Kind" className="h-10 rounded-xl border bg-background px-2 text-sm"><option value="linen">Linen</option><option value="kit">Kit</option></select>
                        <select value={n.name} onChange={(e) => setNeeds((xs) => xs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} aria-label="Which" className="h-10 min-w-0 flex-1 rounded-xl border bg-background px-2 text-sm"><option value="">{opts.length ? 'Choose…' : n.kind === 'kit' ? 'Add kit types under Kits first' : 'Add linens under Linens first'}</option>{opts.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                        <input type="number" min={1} max={20} value={n.qty} onChange={(e) => setNeeds((xs) => xs.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) } : x)))} aria-label="How many" className="h-10 w-16 rounded-xl border bg-background px-2 text-center text-sm" />
                        <button type="button" onClick={() => setNeeds((xs) => xs.filter((_, j) => j !== i))} className="h-10 rounded-xl border px-2 text-xs">Remove</button>
                      </div>); })}
                    <button type="button" onClick={() => setNeeds((xs) => [...xs, { kind: 'linen', name: '', qty: 1 }])} className="h-9 rounded-full border px-3 text-xs font-semibold">+ Add a need</button>
                </div>

                <div className="flex items-center justify-between p-6 rounded-[2rem] border-4 border-destructive/10 bg-destructive/5 shadow-inner transition-all">
                    <div className="space-y-1">
                        <Label htmlFor="out-of-service-edit" className="text-base font-black uppercase tracking-tight text-destructive flex items-center gap-2">
                            <ShieldAlert className="w-4 h-4" /> Out of Service
                        </Label>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">Halt all scheduling for this unit</p>
                    </div>
                    <Controller name="isOutOfService" control={control} render={({ field }) => (
                        <Switch id="out-of-service-edit" checked={field.value} onCheckedChange={field.onChange} className="scale-125 data-[state=checked]:bg-destructive" />
                    )} />
                </div>

                {/* RENT IT OUT — a sauna, room, court or piece of equipment booked by the hour or day with no provider.
                    Public booking, the signed agreement, kiosk check-in, check-out with grace and overstay charges all
                    come from the rental engine; one rental space per unit of capacity. */}
                <div className="space-y-3 rounded-2xl border p-4">
                    <div className="flex items-center justify-between gap-3">
                        <div><p className="text-[14px] font-semibold">Rent this out</p><p className="text-[12px] text-muted-foreground">Clients book it by the hour or day, no provider needed. Check-in, check-out and overstay charges are handled for you.</p></div>
                        <Controller name="rentalEnabled" control={control} render={({ field }) => <Switch checked={!!field.value} onCheckedChange={field.onChange} aria-label="Rent this out" />} />
                    </div>
                    {watch('rentalEnabled') && <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        <label className="space-y-1 text-[12px] font-semibold">Per hour ($)<Input type="number" step="0.01" min={0} {...register('rentalHourly')} className="h-11 rounded-xl" /></label>
                        <label className="space-y-1 text-[12px] font-semibold">Per day ($)<Input type="number" step="0.01" min={0} {...register('rentalDaily')} className="h-11 rounded-xl" /></label>
                        <label className="space-y-1 text-[12px] font-semibold">Minimum (min)<Input type="number" min={0} {...register('rentalMin')} className="h-11 rounded-xl" /></label>
                        <label className="space-y-1 text-[12px] font-semibold">Grace after booked time (min)<Input type="number" min={0} {...register('rentalGrace')} className="h-11 rounded-xl" /></label>
                        <label className="space-y-1 text-[12px] font-semibold">Overstay charged per (min)<Input type="number" min={5} {...register('rentalBlock')} className="h-11 rounded-xl" /></label>
                        <p className="col-span-2 text-[12px] text-muted-foreground sm:col-span-3">Capacity {watch('capacity') || 1} = {watch('capacity') > 1 ? `${watch('capacity')} bookable units` : 'one bookable unit'}. Overstays are charged at the hourly rate in started blocks, after the grace.</p>
                    </div>}
                </div>

                <div className="space-y-2">
                    <Label htmlFor="maint-notes-edit" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Maintenance Log</Label>
                    <Textarea id="maint-notes-edit" {...register('maintenanceNotes')} placeholder="Internal notes regarding unit condition..." className="rounded-2xl border-2 bg-muted/5 min-h-[100px] focus-visible:ring-primary/20" />
                </div>
            </div>
        </div>
    </div>
  );

  const DialogContainer = isMobile ? Sheet : Dialog;
  const ContentComponent = isMobile ? SheetContent : DialogContent;

  return (
    <DialogContainer open={open} onOpenChange={onOpenChange}>
      <ContentComponent
        side={isMobile ? "bottom" : undefined}
        className={cn(
          "p-0 border-none bg-background flex flex-col shadow-3xl overflow-hidden",
          isMobile ? "h-[92dvh] rounded-t-[3rem]" : "sm:max-w-xl max-h-[90dvh]"
        )}
      >
        <FormProvider {...methods}>
          <form onSubmit={handleSubmit(handleSave)} className="flex flex-col flex-1 min-h-0">
            <SheetHeader className={cn("flex-shrink-0 p-8 pb-6 border-b bg-muted/5 text-left", isMobile && "p-6")}>
              <div className="flex items-center gap-3 mb-2">
                <Edit className="w-5 h-5 text-primary" />
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Strategic Refinement</span>
              </div>
              <SheetTitle className="text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">Modify Unit</SheetTitle>
              <SheetDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">Refining record ID: {resource.id.slice(-6).toUpperCase()}</SheetDescription>
            </SheetHeader>

            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className={cn("p-8", isMobile && "p-6")}>
                {formBody}
              </div>
            </div>

            <SheetFooter className="flex-shrink-0 p-8 pt-4 border-t bg-background">
              <div className="grid grid-cols-2 gap-3 w-full">
                <Button variant="ghost" onClick={() => onOpenChange(false)} type="button" className="h-12 font-black uppercase tracking-tighter text-[10px] text-slate-400">Cancel</Button>
                <Button type="submit" className="h-12 rounded-[2rem] font-black uppercase tracking-widest text-[10px] shadow-2xl shadow-primary/30 active:scale-95 transition-all group">
                  Commit Changes <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1" />
                </Button>
              </div>
            </SheetFooter>
          </form>
        </FormProvider>
      </ContentComponent>
    </DialogContainer>
  );
};
