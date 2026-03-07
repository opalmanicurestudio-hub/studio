'use client';

import React, { useState, useMemo, useEffect } from 'react';
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  CalendarIcon, 
  PlusCircle, 
  Trash2, 
  AlertTriangle, 
  ChevronLeft, 
  ChevronRight, 
  Briefcase, 
  User, 
  Lock, 
  Award, 
  CalendarCheck, 
  Clock, 
  Users, 
  Zap, 
  Repeat, 
  Star, 
  Sparkles, 
  Wallet, 
  Check 
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Client, Service, Appointment, Staff, Event, InventoryItem, PricingTier, getServicePrice } from '@/lib/data';
import { format, setHours, setMinutes, startOfDay, areIntervalsOverlapping, addMinutes, startOfWeek, addDays, subWeeks, addWeeks, eachDayOfInterval, isSameDay, isBefore, isToday, addMonths, parseISO } from 'date-fns';
import { SelectAddOnsDialog } from '../services/SelectAddOnsDialog';
import { Card, CardContent } from '../ui/card';
import { nanoid } from 'nanoid';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { useForm, Controller } from 'react-hook-form';
import { Switch } from '../ui/switch';
import { useToast } from '@/hooks/use-toast';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { collection, query, where } from 'firebase/firestore';
import { Badge } from '../ui/badge';
import { motion, AnimatePresence } from 'framer-motion';

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val?.toDate === 'function') return val.toDate();
    if (typeof val === 'string') {
        try {
            return parseISO(val);
        } catch {
            return new Date(val);
        }
    }
    if (typeof val === 'object' && 'seconds' in val) {
        return new Date(val.seconds * 1000);
    }
    return new Date(val);
};

const timeStringToDate = (timeStr: string, date: Date): Date => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    if (!timeStr) return d;
    const [time, period] = timeStr.split(' ');
    let [hours, minutes] = time.split(':').map(Number);
    if (period === 'PM' && hours < 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
    d.setHours(hours, minutes);
    return d;
}

const StaffSelectionCard = ({ staff, isSelected, disabled }: { staff: Staff | { id: string, name: string, avatarUrl: string }, isSelected: boolean, disabled?: boolean }) => {
    const isAnyStaff = staff.id === 'any';
    return (
        <label htmlFor={`staff-select-${staff.id}`} className={cn("block cursor-pointer", disabled && "cursor-not-allowed opacity-40 grayscale-[0.5]")}>
            <div className={cn(
                'relative transition-all duration-300 rounded-2xl border-2 p-4 flex flex-col items-center gap-3', 
                isSelected ? 'border-primary bg-primary/5 ring-4 ring-primary/10 shadow-xl' : 'bg-background border-border hover:border-primary/30', 
                disabled && 'bg-muted/50 border-dashed'
            )}>
                <Avatar className={cn("w-16 h-16 border-4 shadow-sm transition-transform duration-500", isSelected ? "border-primary scale-110" : "border-background")}>
                    {staff.avatarUrl ? <AvatarImage src={staff.avatarUrl} className="object-cover" /> : null}
                    <AvatarFallback className="text-muted-foreground bg-muted font-black uppercase text-xs">
                        {isAnyStaff ? <Users className="w-8 h-8"/> : (staff.name || 'S').charAt(0)}
                    </AvatarFallback>
                </Avatar>
                <p className="font-black uppercase tracking-tight text-[10px] text-center truncate w-full">{staff.name || 'Staff'}</p>
                <RadioGroupItem value={staff.id} id={`staff-select-${staff.id}`} className="sr-only" disabled={disabled} />
                {isSelected && (
                    <div className="absolute top-2 right-2 bg-primary text-white rounded-full p-0.5">
                        <Check className="w-3 h-3" />
                    </div>
                )}
            </div>
        </label>
    );
};

const AddAppointmentForm = ({ 
    onConfirm,
    client: initialClient,
    appointmentToRebook,
    memberships,
}: Omit<AddAppointmentDialogProps, 'open' | 'onOpenChange'>) => {
    const { firestore, user } = useFirebase();
    const { selectedTenant, role } = useTenant();
    const tenantId = selectedTenant?.id;
    
    const { data: clients, isLoading: clientsLoading } = useCollection<Client>(useMemoFirebase(() => tenantId ? collection(firestore, `tenants/${tenantId}/clients`) : null, [firestore, tenantId]));
    const { data: services, isLoading: servicesLoading } = useCollection<Service>(useMemoFirebase(() => tenantId ? collection(firestore, `tenants/${tenantId}/services`) : null, [firestore, tenantId]));
    const { data: allStaff, isLoading: staffLoading } = useCollection<Staff>(useMemoFirebase(() => tenantId ? collection(firestore, `tenants/${tenantId}/staff`) : null, [firestore, tenantId]));

    const { scheduleProfiles, appointments: appointmentsFromDB, events: eventsFromDB } = useInventory();
    const publicScheduleProfile = useMemo(() => scheduleProfiles?.find(p => p.isActive), [scheduleProfiles]);

    const staff = useMemo(() => {
        if (role === 'staff' && user) {
            return allStaff?.filter(s => s.id === user.uid) || [];
        }
        return allStaff || [];
    }, [allStaff, role, user]);
    
    const appointments = useMemo(() => {
        if (!appointmentsFromDB) return [];
        return appointmentsFromDB.map(apt => ({
          ...apt,
          startTime: safeDate(apt.startTime),
          endTime: safeDate(apt.endTime),
        }));
      }, [appointmentsFromDB]);
    
      const events = useMemo(() => {
        if (!eventsFromDB) return [];
        return eventsFromDB.map(evt => ({
            ...evt,
            startTime: safeDate(evt.startTime),
            endTime: safeDate(evt.endTime),
        }));
      }, [eventsFromDB]);

    const { register, handleSubmit, control, watch, formState: { errors }, setValue, reset } = useForm({
        defaultValues: {
            clientId: '',
            serviceId: '',
            staffId: '',
            date: new Date(),
            startTime: '',
            addOnIds: [] as string[],
            isRecurring: false,
            recurrence: {
                frequency: 'weekly',
                endDate: addMonths(new Date(), 3),
            }
        }
    });

    useEffect(() => {
        if (staff && !staffLoading) {
            const staffDefault = (role === 'staff' && user)
                ? user.uid
                : (appointmentToRebook ? (appointmentToRebook.staffId || staff[0]?.id || '') : (staff[0]?.id || ''));

            reset({
                clientId: initialClient?.id || appointmentToRebook?.clientId || '',
                serviceId: appointmentToRebook ? appointmentToRebook.serviceId : '',
                staffId: staffDefault,
                date: appointmentToRebook ? new Date(appointmentToRebook.startTime) : new Date(),
                startTime: appointmentToRebook ? format(new Date(appointmentToRebook.startTime), 'HH:mm') : '',
                addOnIds: appointmentToRebook ? (appointmentToRebook.addOnIds || []) : [],
                isRecurring: false,
                recurrence: {
                    frequency: 'weekly',
                    endDate: addMonths(new Date(), 3),
                }
            });
        }
    }, [staff, staffLoading, appointmentToRebook, initialClient, reset, role, user]);

    const [isAddOnSelectorOpen, setIsAddOnSelectorOpen] = useState(false);
    const [isOverlapping, setIsOverlapping] = useState(false);
    const [clashingItem, setClashingItem] = useState<any | null>(null);
    const [showConfirmation, setShowConfirmation] = useState(false);

    const clientId = watch('clientId');
    const serviceId = watch('serviceId');
    const staffId = watch('staffId');
    const date = watch('date');
    const startTime = watch('startTime');
    const addOnIds = watch('addOnIds');
    
    const selectedService = useMemo(() => services?.find(s => s.id === serviceId), [services, serviceId]);
    const selectedClient = useMemo(() => clients?.find(c => c.id === clientId) || initialClient, [clients, clientId, initialClient]);
    const selectedStaff = useMemo(() => staff?.find(s => s.id === staffId), [staff, staffId]);
    const selectedAddOns = useMemo(() => (services || []).filter(s => (addOnIds || []).includes(s.id)), [services, addOnIds]);
    
    const activeMembership = useMemo(() => {
        if (!selectedClient || !selectedClient.activeMembershipId || !memberships) return null;
        return memberships.find(m => m.id === selectedClient.activeMembershipId);
    }, [selectedClient, memberships]);

    const handleAddOnsChange = (newAddOns: Service[]) => {
        setValue('addOnIds', newAddOns.map(s => s.id));
    };

    const removeAddOn = (addOnId: string) => {
        setValue('addOnIds', addOnIds.filter(id => id !== addOnId));
    };
    
    const weekStart = useMemo(() => startOfWeek(date, { weekStartsOn: 0 }), [date]);
    const weekDays = useMemo(() => eachDayOfInterval({ start: weekStart, end: addDays(weekStart, 6) }), [weekStart]);

    const timeSlots = useMemo(() => {
        if (!selectedService || !date || !publicScheduleProfile || !staff || !services) return [];
        const bookingInterval = publicScheduleProfile.bookingSlotInterval || 15;
        const dayName = format(date, 'eeee').toLowerCase();
        const selectedStaffMember = staff.find(s => s.id === staffId);
        let workingHours;
        const staffDaySchedule = selectedStaffMember?.availability?.week?.[dayName as keyof typeof selectedStaffMember.availability.week];
        if (staffDaySchedule) workingHours = staffDaySchedule;
        else workingHours = publicScheduleProfile?.week?.[dayName];
        
        if (!workingHours || !workingHours.enabled) return [];
        const openT = timeStringToDate(workingHours.start, date);
        const closeT = timeStringToDate(workingHours.end, date);
        const busyIntervals: { start: Date, end: Date }[] = [];

        (appointments || []).filter(apt => {
            if (!isSameDay(apt.startTime, date)) return false;
            if (appointmentToRebook && apt.id === appointmentToRebook.id) return false;
            if (staffId && staffId !== 'any' && apt.staffId !== staffId) return false;
            return true;
        }).forEach(apt => {
            const svc = services.find(s => s.id === apt.serviceId);
            busyIntervals.push({ start: addMinutes(apt.startTime, -(svc?.padBefore || 0)), end: addMinutes(apt.endTime, (svc?.padAfter || 0)) });
        });

        (events || []).filter(evt => {
            if (!isSameDay(evt.startTime, date) || evt.type !== 'blocked') return false;
            return !evt.staffId || evt.staffId === 'all' || (staffId !== 'any' && evt.staffId === staffId);
        }).forEach(evt => { busyIntervals.push({ start: evt.startTime, end: evt.endTime }); });

        const options: string[] = [];
        let currentTime = openT;
        const now = new Date();
        if (isToday(date) && now > openT) {
            const minSinceStart = (now.getHours() * 60) + now.getMinutes();
            const busStartMin = (openT.getHours() * 60) + openT.getMinutes();
            const skip = Math.ceil((minSinceStart - busStartMin) / bookingInterval);
            if (skip > 0) currentTime = addMinutes(openT, skip * bookingInterval);
        }
        
        while (currentTime < closeT) {
            const potentialEnd = addMinutes(currentTime, selectedService.duration + (selectedService.padBefore || 0) + (selectedService.padAfter || 0));
            if (potentialEnd > closeT) break;
            const isOverlapping = busyIntervals.some((interval) => areIntervalsOverlapping({ start: currentTime, end: potentialEnd }, interval, { inclusive: false }));
            if (!isOverlapping) options.push(format(currentTime, 'HH:mm'));
            currentTime = addMinutes(currentTime, bookingInterval);
        }
        return options;
    }, [date, staffId, selectedService, staff, appointments, events, publicScheduleProfile, services, appointmentToRebook]);

    useEffect(() => {
        if (!selectedService || !date || !startTime || !services || !appointments) {
            setIsOverlapping(false);
            setClashingItem(null);
            return;
        }
        const [hours, minutes] = startTime.split(':').map(Number);
        const startDateTime = setMinutes(setHours(startOfDay(date), hours), minutes);
        const totalDuration = selectedService.duration + (selectedService.padBefore || 0) + (selectedService.padAfter || 0);
        const endDateTime = addMinutes(startDateTime, totalDuration);
        const newInterval = { start: startDateTime, end: endDateTime };

        const clashApt = appointments.find(apt => {
            if (appointmentToRebook && apt.id === appointmentToRebook.id) return false;
            if (staffId && staffId !== 'any' && apt.staffId !== staffId) return false;
            return areIntervalsOverlapping(newInterval, { start: apt.startTime, end: apt.endTime }, { inclusive: false });
        });

        if (clashApt) {
            setIsOverlapping(true);
            const svc = services.find(s => s.id === clashApt.serviceId);
            setClashingItem({ type: 'appointment', details: `'${svc?.name || 'Service'}' for ${clashApt.clientName || 'Client'}`, time: `${format(clashApt.startTime, 'h:mm a')} - ${format(clashApt.endTime, 'h:mm a')}` });
            return;
        }

        const clashEvt = events.find(evt => {
            if (evt.type !== 'blocked') return false;
            if (evt.staffId && evt.staffId !== 'all' && staffId !== 'any' && evt.staffId === staffId) return false;
            return areIntervalsOverlapping(newInterval, { start: evt.startTime, end: evt.endTime }, { inclusive: false });
        });

        if (clashEvt) {
            setIsOverlapping(true);
            setClashingItem({ type: 'event', details: `'${clashEvt.title}' event`, time: `${format(clashEvt.startTime, 'h:mm a')} - ${format(clashEvt.endTime, 'h:mm a')}` });
            return;
        }
        setIsOverlapping(false);
        setClashingItem(null);
    }, [date, startTime, selectedService, appointments, services, appointmentToRebook, staffId, events]);

    const confirmAndSubmit = (data: any) => {
        if (!data.clientId || !data.serviceId || !data.date || !data.startTime || !services) return;
        const [hours, minutes] = data.startTime.split(':').map(Number);
        const startDateTime = setMinutes(setHours(startOfDay(data.date), hours), minutes);
        const service = services.find(s => s.id === data.serviceId);
        const endDateTime = addMinutes(startDateTime, service?.duration || 0);
        const allServicesInApt = [service, ...selectedAddOns].filter((s): s is Service => !!s);
        const allRequiredResourceIds = [...new Set(allServicesInApt.flatMap(s => s.requiredResourceIds || []))];

        onConfirm({
            clientId: data.clientId,
            serviceId: data.serviceId,
            staffId: data.staffId,
            startTime: startDateTime,
            endTime: endDateTime,
            status: 'confirmed',
            addOnIds: data.addOnIds || [],
            recurrence: data.isRecurring ? data.recurrence : undefined,
            requiredResourceIds: allRequiredResourceIds,
        });
    }
    
    const handleSaveAttempt = (data: any) => {
        if (!data.clientId || !data.serviceId || !data.startTime) return;
        if (isOverlapping) setShowConfirmation(true);
        else confirmAndSubmit(data);
    };
    
    return (
        <form id="add-appointment-form" onSubmit={handleSubmit(handleSaveAttempt)}>
            <div className="space-y-10 py-4">
                <div className="space-y-6">
                    <h3 className="text-xl font-black uppercase tracking-tight flex items-center gap-3">
                        <Users className="w-6 h-6 text-primary" />
                        Engagement
                    </h3>
                    {selectedClient && (selectedClient.outstandingBalance || 0) > 0 && (
                        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
                            <Alert variant="destructive" className="bg-destructive/5 border-destructive/20 border-2 rounded-[2rem] p-6 shadow-xl shadow-destructive/5" style={{ '--primary': '0 84.2% 60.2%' } as any}>
                                <Wallet className="h-6 w-6" />
                                <AlertTitle className="text-sm font-black uppercase tracking-tight mb-2">Balance Detected</AlertTitle>
                                <AlertDescription className="text-xs font-bold leading-relaxed opacity-80 uppercase">
                                    Account balance of <strong>${selectedClient.outstandingBalance!.toFixed(2)}</strong> found. Settle at POS to clear.
                                </AlertDescription>
                            </Alert>
                        </motion.div>
                    )}
                    <div className="space-y-3">
                        <Label htmlFor="client" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Client Rolodex</Label>
                        <div className="flex gap-2">
                            <Controller
                                name="clientId"
                                control={control}
                                render={({ field }) => (
                                    <Select onValueChange={field.onChange} value={field.value}>
                                        <SelectTrigger id="client" className="h-14 rounded-2xl border-2 shadow-inner bg-muted/5 font-bold">
                                            {selectedClient ? (
                                                <div className="flex items-center gap-3">
                                                    <Avatar className="h-7 w-7 md:h-8 md:w-8 border-2 shadow-sm rounded-xl">
                                                        <AvatarImage src={selectedClient.avatarUrl} className="object-cover" />
                                                        <AvatarFallback className="font-black text-xs bg-primary/10 text-primary">{(selectedClient.name || 'C')?.charAt(0)}</AvatarFallback>
                                                    </Avatar>
                                                    <span className="uppercase tracking-tight text-xs md:text-sm">{selectedClient.name}</span>
                                                </div>
                                            ) : (
                                                <SelectValue placeholder="Select a client" />
                                            )}
                                        </SelectTrigger>
                                        <SelectContent className="rounded-2xl border-2 shadow-2xl">
                                            {(clients || []).map(c => (
                                                <SelectItem key={c.id} value={c.id} className="rounded-xl">
                                                    <div className="flex items-center gap-3 py-1">
                                                        <Avatar className="w-8 h-8 border shadow-sm rounded-xl">
                                                            <AvatarImage src={c.avatarUrl} className="object-cover" />
                                                            <AvatarFallback className="font-black text-xs">{(c.name || 'C')?.charAt(0)}</AvatarFallback>
                                                        </Avatar>
                                                        <span className="font-bold uppercase tracking-tight">{c.name}</span>
                                                    </div>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}
                            />
                            <Button variant="outline" size="icon" type="button" className="h-14 w-14 rounded-2xl border-2 shrink-0"><PlusCircle className="h-6 w-6" /></Button>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        <div className="space-y-3">
                            <Label htmlFor="staff" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Assigned Professional</Label>
                            <Controller
                                name="staffId"
                                control={control}
                                render={({ field }) => (
                                    <Select onValueChange={field.onChange} value={field.value} disabled={role==='staff'}>
                                        <SelectTrigger id="staff" className="h-14 rounded-2xl border-2 shadow-inner bg-muted/5 font-bold">
                                            {selectedStaff ? (
                                                <div className="flex items-center gap-3 min-w-0">
                                                    <Avatar className="h-7 w-7 md:h-8 md:w-8 border-2 shadow-sm rounded-xl shrink-0">
                                                        <AvatarImage src={selectedStaff.avatarUrl} className="object-cover" />
                                                        <AvatarFallback className="font-black text-xs bg-primary/10 text-primary">{(selectedStaff.name || 'S')?.charAt(0)}</AvatarFallback>
                                                    </Avatar>
                                                    <span className="uppercase tracking-tight text-xs md:text-sm truncate">{(selectedStaff.name || 'Staff').split(' ')[0]}</span>
                                                </div>
                                            ) : (
                                                <SelectValue placeholder="Professional" />
                                            )}
                                        </SelectTrigger>
                                        <SelectContent className="rounded-2xl border-2 shadow-2xl">
                                            {(role === 'owner' || role === 'admin' ? (allStaff || []) : (allStaff || []).filter(s => s.id === user?.uid)).map(s => (
                                                <SelectItem key={s.id} value={s.id} className="rounded-xl">
                                                    <div className="flex items-center gap-3 py-1">
                                                        <Avatar className="w-8 h-8 border shadow-sm rounded-xl">
                                                            <AvatarImage src={s.avatarUrl} className="object-cover" />
                                                            <AvatarFallback className="font-black text-xs">{(s?.name || 'S')?.charAt(0)}</AvatarFallback>
                                                        </Avatar>
                                                        <span className="font-bold uppercase tracking-tight">{s?.name || 'Unknown Staff'}</span>
                                                    </div>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}
                            />
                        </div>
                        <div className="space-y-3">
                            <Label htmlFor="service" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Treatment Menu</Label>
                            <Controller
                                name="serviceId"
                                control={control}
                                render={({ field }) => (
                                    <Select onValueChange={field.onChange} value={field.value}>
                                        <SelectTrigger id="service" className="h-14 rounded-2xl border-2 shadow-inner bg-muted/5 font-bold">
                                            <SelectValue placeholder="Select service" />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-2xl border-2 shadow-2xl">
                                            {(services || []).filter(s => s.type === 'service').map(s => {
                                                const isMembershipPerk = activeMembership?.includedServices?.some(perk => perk.id === s.id);
                                                return (
                                                    <SelectItem key={s.id} value={s.id} className="rounded-xl">
                                                        <div className="flex items-center w-full gap-3 py-1">
                                                            <span className="flex-1 font-bold uppercase tracking-tight">{s.name}</span>
                                                            {isMembershipPerk && (
                                                                <Badge className="bg-primary text-white border-none h-5 px-2 text-[8px] font-black uppercase tracking-widest">
                                                                    <Star className="mr-1 h-2.5 w-2.5 fill-current" /> Perk
                                                                </Badge>
                                                            )}
                                                        </div>
                                                    </SelectItem>
                                                )
                                            })}
                                        </SelectContent>
                                    </Select>
                                )}
                            />
                        </div>
                    </div>
                </div>

                <div className="space-y-6 pt-6 border-t border-dashed">
                    <div className="flex items-center justify-between">
                        <h3 className="text-lg font-black uppercase tracking-tight flex items-center gap-3">
                            <PlusCircle className="w-6 h-6 text-primary" />
                            Add-ons
                        </h3>
                        <Button variant="ghost" onClick={() => setIsAddOnSelectorOpen(true)} type="button" className="h-auto p-0 text-[10px] font-black uppercase tracking-[0.2em] text-primary underline">Browse Extras</Button>
                    </div>
                    {selectedAddOns.length > 0 ? (
                        <div className="grid grid-cols-1 gap-2">
                            {selectedAddOns.map(item => (
                                <div key={item.id} className="flex items-center justify-between p-4 rounded-[1.25rem] bg-muted/20 border-2 transition-all hover:bg-muted/30">
                                    <span className="text-xs font-black uppercase tracking-tight text-slate-700">{item.name}</span>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeAddOn(item.id)}><Trash2 className="w-4 h-4" /></Button>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="p-8 text-center text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground/40 border-4 border-dashed rounded-[2rem]">No Add-ons Selected</div>
                    )}
                </div>

                <div className="space-y-6 pt-6 border-t border-dashed">
                    <h3 className="text-lg font-black uppercase tracking-tight flex items-center gap-3">
                        <CalendarCheck className="w-6 h-6 text-primary" />
                        Timing
                    </h3>
                    <div className="space-y-3">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Schedule Picker</Label>
                        <div className="rounded-[2.5rem] border-2 bg-muted/10 p-6 space-y-8 shadow-inner">
                            <div className="flex justify-between items-center px-2">
                                <Button variant="outline" size="icon" onClick={() => setValue('date', subWeeks(date, 1))} type="button" className="h-10 w-10 rounded-full bg-background shadow-md border-none"><ChevronLeft className="w-5 h-5" /></Button>
                                <span className="font-black uppercase tracking-widest text-sm">{format(date, 'MMMM yyyy')}</span>
                                <Button variant="outline" size="icon" onClick={() => setValue('date', addWeeks(date, 1))} type="button" className="h-10 w-10 rounded-full bg-background shadow-md border-none"><ChevronRight className="w-5 h-5" /></Button>
                            </div>
                            <div className="grid grid-cols-7 gap-3">
                                {weekDays.map(day => (
                                    <button 
                                        key={day.toISOString()} 
                                        onClick={() => setValue('date', day)} 
                                        disabled={isBefore(day, startOfDay(new Date())) && !isToday(day)} 
                                        className={cn(
                                            "flex flex-col items-center justify-center p-3 rounded-2xl border-2 transition-all aspect-square", 
                                            isSameDay(day, date) ? "bg-primary text-primary-foreground border-primary shadow-2xl scale-110" : "bg-background border-transparent hover:border-primary/30", 
                                            (isBefore(day, startOfDay(new Date())) && !isToday(day)) && "opacity-20 cursor-not-allowed"
                                        )} 
                                        type="button"
                                    >
                                        <span className="text-[10px] uppercase font-black opacity-60 mb-1">{format(day, 'EEE')}</span>
                                        <span className="font-black text-xl tracking-tighter">{format(day, 'd')}</span>
                                    </button>
                                ))}
                            </div>
                            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 pt-8 border-t-2 border-dashed border-white/50">
                                {timeSlots.map(time => (
                                    <Button 
                                        key={time} 
                                        variant={startTime === time ? 'default' : 'outline'} 
                                        onClick={() => setValue('startTime', time)} 
                                        type="button"
                                        className={cn(
                                            "h-14 font-black uppercase text-xs tracking-widest rounded-2xl border-2 transition-all", 
                                            startTime === time ? "shadow-2xl shadow-primary/20 scale-105" : "bg-background"
                                        )}
                                    >
                                        {format(timeStringToDate(time, new Date()), 'h:mm a')}
                                    </Button>
                                ))}
                                {timeSlots.length === 0 && (<div className="col-span-full text-center text-[10px] font-black uppercase tracking-widest text-muted-foreground/40 py-12 border-2 border-dashed rounded-[2rem]">No Availability</div>)}
                            </div>
                        </div>
                    </div>
                    {isOverlapping && (
                        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                            <Alert variant="destructive" className="mt-2 border-4 border-destructive bg-destructive/5 rounded-[2rem] p-6 shadow-2xl" style={{ '--primary': '0 84.2% 60.2%' } as any}>
                                <AlertTriangle className="h-6 w-6" />
                                <AlertTitle className="text-sm font-black uppercase tracking-tighter mb-2">Clash Warning</AlertTitle>
                                <AlertDescription className="space-y-3 pt-1">
                                    <p className="text-xs font-bold leading-relaxed opacity-80 uppercase">The selected window overlaps with another session.</p>
                                    {clashingItem && (
                                        <div className="pt-3 border-t border-destructive/20">
                                            <p className="font-black text-xs uppercase tracking-tight">{clashingItem.details}</p>
                                            <p className="text-[10px] font-black opacity-60 mt-1 uppercase tracking-widest">{clashingItem.time}</p>
                                        </div>
                                    )}
                                </AlertDescription>
                            </Alert>
                        </motion.div>
                    )}
                </div>

                <div className="space-y-6 pt-6 border-t border-dashed">
                    <Controller
                        name="isRecurring"
                        control={control}
                        render={({ field }) => (
                            <div className="flex items-center justify-between p-6 border-2 rounded-[2rem] bg-primary/[0.03] border-primary/10 shadow-sm">
                                <div className="space-y-1">
                                    <Label htmlFor="is-recurring" className="text-lg font-black uppercase tracking-tight">Recurring Schedule</Label>
                                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">Automate future appointments</p>
                                </div>
                                <Switch id="is-recurring" checked={field.value} onCheckedChange={field.onChange} className="scale-125" />
                            </div>
                        )}
                    />
                    <AnimatePresence>
                        {watch('isRecurring') && (
                            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                                <Card className="bg-muted/10 border-2 rounded-[2rem] shadow-inner">
                                    <CardContent className="p-8 grid grid-cols-1 md:grid-cols-2 gap-8">
                                        <Controller
                                            name="recurrence.frequency"
                                            control={control}
                                            render={({ field }) => (
                                                <div className="space-y-3">
                                                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Frequency</Label>
                                                    <Select onValueChange={field.onChange} value={field.value}>
                                                        <SelectTrigger className="h-14 rounded-2xl border-2 font-bold bg-background"><SelectValue /></SelectTrigger>
                                                        <SelectContent className="rounded-2xl border-2 shadow-2xl">
                                                            <SelectItem value="weekly" className="font-bold">Weekly</SelectItem>
                                                            <SelectItem value="bi-weekly" className="font-bold">Bi-Weekly</SelectItem>
                                                            <SelectItem value="every-3-weeks" className="font-bold">Every 3 Weeks</SelectItem>
                                                            <SelectItem value="every-4-weeks" className="font-bold">Every 4 Weeks</SelectItem>
                                                            <SelectItem value="monthly" className="font-bold">Monthly</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            )}
                                        />
                                        <Controller
                                            name="recurrence.endDate"
                                            control={control}
                                            render={({ field }) => (
                                                <div className="space-y-3">
                                                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">End Date</Label>
                                                    <input 
                                                        type="date" 
                                                        value={field.value ? format(field.value, 'yyyy-MM-dd') : ''}
                                                        onChange={(e) => {
                                                            const d = e.target.value ? new Date(e.target.value.replace(/-/g, '/')) : undefined;
                                                            field.onChange(d);
                                                        }}
                                                        className="w-full h-14 rounded-2xl border-2 bg-background px-4 font-black text-lg focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all outline-none shadow-md"
                                                    />
                                                </div>
                                            )}
                                        />
                                    </CardContent>
                                </Card>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>
            <SelectAddOnsDialog 
                open={isAddOnSelectorOpen} 
                onOpenChange={setIsAddOnSelectorOpen} 
                allAddOns={(services || []).filter(s => s.type === 'addon')} 
                initialSelected={selectedAddOns} 
                onSelect={handleAddOnsChange} 
            />
            <AlertDialog open={showConfirmation} onOpenChange={setShowConfirmation}>
                <AlertDialogContent className="rounded-[3rem] border-4 shadow-3xl">
                    <AlertDialogHeader className="p-6 pb-0 text-center sm:text-left">
                        <AlertDialogTitle className="font-black uppercase tracking-tighter text-2xl">Confirm Overlap</AlertDialogTitle>
                        <AlertDialogDescription className="font-bold text-sm text-slate-600 leading-relaxed uppercase">
                            This time slot overlaps with {clashingItem?.details || 'an existing item'}. Force this booking?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="p-6 pt-4 flex flex-col gap-3">
                        <Button onClick={handleSubmit(confirmAndSubmit)} className="w-full h-16 rounded-2xl font-black uppercase tracking-widest shadow-2xl shadow-primary/20">Book Anyway</Button>
                        <AlertDialogCancel onClick={() => setShowConfirmation(false)} className="w-full h-12 rounded-xl font-bold uppercase text-[10px] tracking-widest border-none">Cancel</AlertDialogCancel>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </form>
    )
}

export const AddAppointmentDialog: React.FC<AddAppointmentDialogProps> = ({ open, onOpenChange, onConfirm, client, appointmentToRebook, memberships }) => {
  const isMobile = useIsMobile();
  const formKey = useMemo(() => appointmentToRebook ? `rebook-${appointmentToRebook.id}` : `new-${client?.id || 'fresh'}`, [appointmentToRebook, client]);

  const dialogTitle = "New Session";
  const dialogDescription = "Reserve a studio session for your guest.";
  
  const FormContent = <AddAppointmentForm 
    key={formKey}
    onConfirm={onConfirm} 
    client={client} 
    appointmentToRebook={appointmentToRebook}
    memberships={memberships}
    />;

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[95vh] flex flex-col p-0 border-none rounded-t-[3rem] bg-background shadow-2xl">
          <SheetHeader className="p-8 pb-6 border-b bg-muted/5 flex-shrink-0 text-left">
            <div className="flex items-center gap-3 mb-2">
                <Sparkles className="w-5 h-5 text-primary" />
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Planning Studio</span>
            </div>
            <SheetTitle className="text-3xl font-black uppercase tracking-tighter text-slate-900">{dialogTitle}</SheetTitle>
            <SheetDescription className="text-xs font-bold uppercase tracking-widest opacity-60">{dialogDescription}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto">
              <div className="px-8">{FormContent}</div>
          </div>
          <SheetFooter className="p-8 pt-4 border-t bg-background flex-shrink-0">
            <div className="flex w-full gap-4">
                <Button variant="ghost" onClick={() => onOpenChange(false)} className="flex-1 h-12 font-black uppercase tracking-tighter text-[10px] text-slate-400">Cancel</Button>
                <Button type="submit" form="add-appointment-form" className="flex-[2.5] h-12 font-black uppercase tracking-widest text-[10px] rounded-[2rem] shadow-2xl shadow-primary/30">Complete Booking</Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0 border-4 rounded-[3rem] overflow-hidden shadow-3xl bg-background">
         <DialogHeader className="p-10 pb-6 border-b bg-muted/5 text-left">
            <div className="flex items-center gap-3 mb-2">
                <Sparkles className="w-5 h-5 text-primary" />
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Planning Studio</span>
            </div>
            <DialogTitle className="text-4xl font-black uppercase tracking-tighter text-slate-900">{dialogTitle}</DialogTitle>
            <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60">{dialogDescription}</DialogDescription>
        </DialogHeader>
        <ScrollArea className="flex-1">
            <div className="px-10">
                {FormContent}
            </div>
        </ScrollArea>
        <DialogFooter className="p-10 pt-6 border-t bg-background">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="h-14 px-8 rounded-2xl font-bold uppercase tracking-tight">Cancel</Button>
          <Button type="submit" form="add-appointment-form" className="h-14 px-12 rounded-2xl font-black uppercase tracking-widest shadow-xl shadow-primary/20">Book Appointment</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export interface AddAppointmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (appointmentData: any) => void;
  client?: Client | null;
  appointmentToRebook?: Appointment | null;
  memberships: Membership[];
}
