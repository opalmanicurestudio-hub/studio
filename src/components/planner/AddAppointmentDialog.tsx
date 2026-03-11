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
  Check,
  ArrowRight
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
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { StaffSelectionCard } from '../shared/StaffSelectionCard';

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val === 'string') {
        try {
            return parseISO(val);
        } catch {
            return new Date(val);
        }
    }
    if (typeof val?.toDate === 'function') return val.toDate();
    if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
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

const AddAppointmentForm = ({ 
    onConfirm,
    client: initialClient,
    appointmentToRebook,
    memberships,
}: Omit<AddAppointmentDialogProps, 'open' | 'onOpenChange'>) => {
    const { firestore, user } = useFirebase();
    const { selectedTenant, role } = useTenant();
    const tenantId = selectedTenant?.id;
    
    const { data: clients } = useCollection<Client>(useMemoFirebase(() => tenantId ? collection(firestore, `tenants/${tenantId}/clients`) : null, [firestore, tenantId]));
    const { data: services } = useCollection<Service>(useMemoFirebase(() => tenantId ? collection(firestore, `tenants/${tenantId}/services`) : null, [firestore, tenantId]));
    const { data: allStaff, isLoading: staffLoading } = useCollection<Staff>(useMemoFirebase(() => tenantId ? collection(firestore, `tenants/${tenantId}/staff`) : null, [firestore, tenantId]));
    const { data: pricingTiers } = useCollection<PricingTier>(useMemoFirebase(() => tenantId ? collection(firestore, `tenants/${tenantId}/pricingTiers`) : null, [firestore, tenantId]));

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

    const { register, handleSubmit, control, watch, reset, setValue } = useForm({
        defaultValues: {
            clientId: '',
            serviceId: '',
            staffId: 'any',
            selectedTierId: 'any',
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
                : (appointmentToRebook ? (appointmentToRebook.staffId || 'any') : 'any');

            reset({
                clientId: initialClient?.id || appointmentToRebook?.clientId || '',
                serviceId: appointmentToRebook ? appointmentToRebook.serviceId : '',
                staffId: staffDefault,
                selectedTierId: 'any',
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

    const [isOverlapping, setIsOverlapping] = useState(false);
    const [clashingItem, setClashingItem] = useState<any | null>(null);
    const [showConfirmation, setShowConfirmation] = useState(false);

    const clientId = watch('clientId');
    const serviceId = watch('serviceId');
    const staffId = watch('staffId');
    const selectedTierId = watch('selectedTierId');
    const date = watch('date');
    const startTime = watch('startTime');
    const addOnIds = watch('addOnIds');
    
    const selectedService = useMemo(() => services?.find(s => s.id === serviceId), [services, serviceId]);
    const selectedClient = useMemo(() => clients?.find(c => c.id === clientId) || initialClient, [clients, clientId, initialClient]);
    const selectedAddOns = useMemo(() => (services || []).filter(s => (addOnIds || []).includes(s.id)), [services, addOnIds]);
    
    const activeMembership = useMemo(() => {
        if (!selectedClient || (!selectedClient.activeMembershipId && !selectedClient.subscription?.membershipId) || !memberships) return null;
        return memberships.find(m => m.id === (selectedClient.activeMembershipId || selectedClient.subscription?.membershipId));
    }, [selectedClient, memberships]);

    const qualifiedStaff = useMemo(() => {
        if (!selectedService?.requiredSkills || selectedService.requiredSkills.length === 0) return staff;
        return staff.filter(s => selectedService.requiredSkills!.every(skill => (s.skillSet || []).includes(skill)));
    }, [selectedService, staff]);

    const availableTiersForService = useMemo(() => {
        if (!selectedService?.serviceTiers || selectedService.serviceTiers.length === 0 || !pricingTiers) return [];
        const tiersWithStaff = new Set(qualifiedStaff.map(s => s.pricingTierId).filter(Boolean));
        return selectedService.serviceTiers
            .filter(st => tiersWithStaff.has(st.tierId))
            .map(st => ({
                ...st,
                name: pricingTiers.find(pt => pt.id === st.tierId)?.name || 'Tier'
            }));
    }, [selectedService, qualifiedStaff, pricingTiers]);

    const weekStart = useMemo(() => startOfWeek(date, { weekStartsOn: 0 }), [date]);
    const weekDays = useMemo(() => eachDayOfInterval({ start: weekStart, end: addDays(weekStart, 6) }), [weekStart]);

    const timeSlots = useMemo(() => {
        if (!selectedService || !date || !publicScheduleProfile || !staff || !services) return [];
        const bookingInterval = publicScheduleProfile.bookingSlotInterval || 15;
        const dayName = format(date, 'eeee').toLowerCase();
        
        let staffToAudit = staffId === 'any' ? qualifiedStaff : qualifiedStaff.filter(s => s.id === staffId);
        if (staffId === 'any' && selectedTierId !== 'any') {
            staffToAudit = staffToAudit.filter(s => s.pricingTierId === selectedTierId);
        }

        const options: Set<string> = new Set();
        
        staffToAudit.forEach(staffMember => {
            let workingHours;
            const staffDaySchedule = staffMember?.availability?.week?.[dayName as keyof typeof staffMember.availability.week];
            if (staffDaySchedule?.enabled) workingHours = staffDaySchedule;
            else if (staffDaySchedule && !staffDaySchedule.enabled) return;
            else workingHours = publicScheduleProfile?.week?.[dayName];
            
            if (!workingHours || !workingHours.enabled) return;
            const dayStartWithBusinessHours = timeStringToDate(workingHours.start, date);
            const dayEndWithBusinessHours = timeStringToDate(workingHours.end, date);
            const busyIntervals: { start: Date, end: Date }[] = [];

            appointments.filter(apt => isSameDay(apt.startTime, date) && apt.staffId === staffMember.id).forEach(apt => {
                const aptService = services.find(s => s.id === apt.serviceId);
                const padBefore = aptService?.padBefore || 0;
                const padAfter = aptService?.padAfter || 0;
                busyIntervals.push({ start: addMinutes(apt.startTime, -padBefore), end: addMinutes(apt.endTime, padAfter) });
            });

            events.filter(evt => isSameDay(evt.startTime, date) && evt.type === 'blocked' && (!evt.staffIds || evt.staffIds.includes('all') || evt.staffIds.includes(staffMember.id))).forEach(evt => {
                busyIntervals.push({ start: safeDate(evt.startTime), end: safeDate(evt.endTime) });
            });

            let currentTime = dayStartWithBusinessHours;
            const now = new Date();
            if (isToday(date)) {
                const minSinceStart = (now.getHours() * 60) + now.getMinutes();
                const busStartMin = (currentTime.getHours() * 60) + currentTime.getMinutes();
                const skip = Math.ceil((minSinceStart - busStartMin) / bookingInterval);
                if (skip > 0) currentTime = addMinutes(dayStartWithBusinessHours, skip * bookingInterval);
            }
            
            while (currentTime < dayEndWithBusinessHours) {
                const potentialEnd = addMinutes(currentTime, selectedService.duration + (selectedService.padBefore || 0) + (selectedService.padAfter || 0));
                if (potentialEnd > dayEndWithBusinessHours) break;
                const isOverlapping = busyIntervals.some((interval) => areIntervalsOverlapping({ start: currentTime, end: potentialEnd }, interval, { inclusive: false }));
                
                const isStaffActiveForSameDay = !isToday(date) || (staffMember.active && !staffMember.onBreak);

                if (!isOverlapping && isStaffActiveForSameDay) {
                    options.add(format(currentTime, 'HH:mm'));
                }
                currentTime = addMinutes(currentTime, bookingInterval);
            }
        });
        return Array.from(options).sort();
    }, [date, staffId, selectedTierId, qualifiedStaff, selectedService, staff, appointments, events, publicScheduleProfile, services]);

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

        if (staffId === 'any') {
            setIsOverlapping(false);
            setClashingItem(null);
            return;
        }

        const clashApt = appointments.find(apt => {
            if (appointmentToRebook && apt.id === appointmentToRebook.id) return false;
            if (staffId && apt.staffId !== staffId) return false;
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
            if (evt.staffIds && !evt.staffIds.includes('all') && !evt.staffIds.includes(staffId)) return false;
            return areIntervalsOverlapping(newInterval, { start: safeDate(evt.startTime), end: safeDate(evt.endTime) }, { inclusive: false });
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
        if (!service) return;
        
        const endDateTime = addMinutes(startDateTime, service.duration);
        const allServicesInApt = [service, ...selectedAddOns].filter((s): s is Service => !!s);
        const allRequiredResourceIds = [...new Set(allServicesInApt.flatMap(s => s.requiredResourceIds || []))];

        let finalStaffId = data.staffId;
        
        if (finalStaffId === 'any') {
            let candidates = qualifiedStaff.filter(s => {
                if (data.selectedTierId !== 'any' && s.pricingTierId !== data.selectedTierId) return false;
                if (isToday(startDateTime) && (!s.active || s.onBreak)) return false;
                
                const dayName = format(startDateTime, 'eeee').toLowerCase();
                const sched = s.availability?.week?.[dayName as keyof typeof s.availability.week] || publicScheduleProfile?.week?.[dayName];
                if (!sched?.enabled) return false;
                
                const openT = timeStringToDate(sched.start, startDateTime);
                const closeT = timeStringToDate(sched.end, startDateTime);
                if (startDateTime < openT || endDateTime > closeT) return false;

                const isAptOverlapping = appointments.some(apt => 
                    apt.staffId === s.id && 
                    apt.status !== 'cancelled' && 
                    areIntervalsOverlapping({ start: startDateTime, end: endDateTime }, { start: apt.startTime, end: apt.endTime }, { inclusive: false })
                );
                if (isAptOverlapping) return false;

                const isEventOverlapping = events.some(evt => 
                    evt.type === 'blocked' && 
                    (!evt.staffIds || evt.staffIds.includes('all') || evt.staffIds.includes(s.id)) && 
                    areIntervalsOverlapping({ start: startDateTime, end: endDateTime }, { start: evt.startTime, end: evt.endTime }, { inclusive: false })
                );
                if (isEventOverlapping) return false;

                return true;
            });

            if (candidates.length > 0) {
                candidates.sort((a, b) => {
                    const timeA = a.lastServedTimestamp ? parseISO(a.lastServedTimestamp).getTime() : 0;
                    const timeB = b.lastServedTimestamp ? parseISO(b.lastServedTimestamp).getTime() : 0;
                    return timeA - timeB;
                });
                finalStaffId = candidates[0].id;
            } else {
                toast({ variant: 'destructive', title: 'Operational Conflict', description: 'No qualified professionals are available for this specific window and tier.' });
                return;
            }
        }

        onConfirm({
            clientId: data.clientId,
            serviceId: data.serviceId,
            staffId: finalStaffId,
            startTime: startDateTime,
            endTime: endDateTime,
            status: 'confirmed',
            addOnIds: data.addOnIds || [],
            recurrence: data.isRecurring ? data.recurrence : undefined,
            requiredResourceIds: allRequiredResourceIds,
        });
    }
    
    const handleSaveAttempt = (data: any) => {
        if (isOverlapping) setShowConfirmation(true);
        else confirmAndSubmit(data);
    };
    
    return (
        <form id="add-appointment-form" onSubmit={handleSubmit(handleSaveAttempt)}>
            <div className={cn("space-y-6 md:space-y-10 py-4")}>
                <div className="space-y-4 md:space-y-6">
                    <h3 className="text-base md:text-xl font-black uppercase tracking-tight flex items-center gap-3">
                        <Users className="w-5 h-5 md:w-6 md:h-6 text-primary" />
                        Engagement
                    </h3>
                    <div className="space-y-3 text-left">
                        <div className="flex items-center justify-between px-1">
                            <Label htmlFor="client" className="text-[9px] md:text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Client Dossier</Label>
                            {activeMembership && (
                                <Badge className="bg-indigo-600 text-white border-none h-5 px-2 text-[8px] font-black uppercase tracking-widest">
                                    <Award className="mr-1 h-3 w-3" /> {activeMembership.name}
                                </Badge>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <Controller
                                name="clientId"
                                control={control}
                                render={({ field }) => (
                                    <Select onValueChange={field.onChange} value={field.value}>
                                        <SelectTrigger id="client" className="h-12 md:h-14 rounded-2xl border-2 shadow-inner bg-muted/5 font-bold">
                                            {selectedClient ? (
                                                <div className="flex items-center gap-3">
                                                    <div className="relative shrink-0">
                                                        <Avatar className="h-7 w-7 border-2 shadow-sm rounded-xl">
                                                            <AvatarImage src={selectedClient.avatarUrl} className="object-cover" />
                                                            <AvatarFallback className="font-black text-[10px] bg-primary/10 text-primary">{(selectedClient.name || 'C')?.charAt(0)}</AvatarFallback>
                                                        </Avatar>
                                                        {(selectedClient.activeMembershipId || selectedClient.subscription?.membershipId) && (
                                                            <div className="absolute -top-1 -right-1 bg-indigo-600 text-white p-0.5 rounded shadow-sm border border-background">
                                                                <Award className="w-2 h-2" />
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <span className="uppercase tracking-tight text-[11px] md:text-sm truncate">{selectedClient.name}</span>
                                                    </div>
                                                </div>
                                            ) : (
                                                <SelectValue placeholder="SEARCH ROSTER..." />
                                            )}
                                        </SelectTrigger>
                                        <SelectContent className="rounded-xl border-2 shadow-2xl">
                                            {(clients || []).map(c => {
                                                const isMem = !!(c.activeMembershipId || c.subscription?.membershipId);
                                                return (
                                                    <SelectItem key={c.id} value={c.id} className="rounded-xl">
                                                        <div className="flex items-center w-full gap-3 py-1">
                                                            <div className="relative shrink-0">
                                                                <Avatar className="h-8 w-8 border shadow-sm rounded-xl">
                                                                    <AvatarImage src={c.avatarUrl} className="object-cover" />
                                                                    <AvatarFallback className="font-black text-xs">{(c.name || 'C')?.charAt(0)}</AvatarFallback>
                                                                </Avatar>
                                                                {isMem && (
                                                                    <div className="absolute -top-1 -right-1 bg-indigo-600 text-white p-0.5 rounded shadow-sm border border-background">
                                                                        <Award className="w-2 h-2" />
                                                                    </div>
                                                                )}
                                                            </div>
                                                            <span className="flex-1 font-bold uppercase tracking-tight">{c.name}</span>
                                                            {isMem && (
                                                                <Badge className="bg-indigo-600 text-white border-none h-4 px-1.5 text-[7px] font-black uppercase tracking-widest shrink-0">Member</Badge>
                                                            )}
                                                        </div>
                                                    </SelectItem>
                                                )
                                            })}
                                        </SelectContent>
                                    </Select>
                                )}
                            />
                            <Button variant="outline" size="icon" type="button" className="h-12 w-12 md:h-14 md:w-14 rounded-2xl border-2 shrink-0"><PlusCircle className="h-5 w-5 md:h-6 md:w-6" /></Button>
                        </div>
                    </div>
                    
                    <div className="space-y-3 text-left">
                        <Label htmlFor="service" className="text-[9px] md:text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Treatment Catalog</Label>
                        <Controller
                            name="serviceId"
                            control={control}
                            render={({ field }) => (
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <SelectTrigger id="service" className="h-12 md:h-14 rounded-2xl border-2 shadow-inner bg-muted/5 font-bold">
                                        <SelectValue placeholder="SELECT SERVICE..." />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-xl border-2 shadow-2xl">
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

                <div className="space-y-6 pt-6 border-t border-dashed">
                    <div className="space-y-1">
                        <h3 className="text-base md:text-lg font-black uppercase tracking-tight flex items-center gap-3">
                            <Users className="w-5 h-5 md:w-6 md:h-6 text-primary" />
                            Provider Assignment
                        </h3>
                        <p className="text-[8px] md:text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60 ml-8 md:ml-9">Select a specific pro or use smart rotation logic.</p>
                    </div>
                    
                    <Controller
                        name="staffId"
                        control={control}
                        render={({ field }) => (
                            <RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4" disabled={role==='staff'}>
                                <StaffSelectionCard 
                                    staff={{ id: 'any', name: 'Smart Rotation', avatarUrl: '' }} 
                                    pricingTiers={pricingTiers || []} 
                                    isSelected={field.value === 'any'}
                                />
                                {(qualifiedStaff || []).map(s => (
                                    <StaffSelectionCard 
                                        key={s.id} 
                                        staff={s} 
                                        pricingTiers={pricingTiers || []} 
                                        isSelected={field.value === s.id}
                                    />
                                ))}
                            </RadioGroup>
                        )}
                    />

                    <AnimatePresence>
                        {staffId === 'any' && availableTiersForService.length > 0 && (
                            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4 pt-6 border-t-2 border-dashed">
                                <Label className="text-[9px] md:text-[10px] font-black uppercase tracking-widest text-primary flex items-center gap-2">
                                    <Sparkles className="w-3 h-3" /> Tier Routing Preference
                                </Label>
                                <Controller
                                    name="selectedTierId"
                                    control={control}
                                    render={({ field }) => (
                                        <RadioGroup value={field.value} onValueChange={field.onChange} className="grid grid-cols-1 gap-2">
                                            <label htmlFor="tier-any-plan" className="flex items-center justify-between p-4 rounded-2xl border-2 cursor-pointer transition-all hover:bg-muted/50 has-[:checked]:border-primary has-[:checked]:bg-primary/5 shadow-sm">
                                                <div className="flex items-center gap-3">
                                                    <RadioGroupItem value="any" id="tier-any-plan" />
                                                    <span className="text-[10px] md:text-[11px] font-black uppercase tracking-tight">First Available (Any Tier)</span>
                                                </div>
                                            </label>
                                            {availableTiersForService.map(tier => (
                                                <label key={tier.tierId} htmlFor={`tier-p-${tier.tierId}`} className="flex items-center justify-between p-4 rounded-2xl border-2 cursor-pointer transition-all hover:bg-muted/50 has-[:checked]:border-primary has-[:checked]:bg-primary/5 shadow-sm">
                                                    <div className="flex items-center gap-3">
                                                        <RadioGroupItem value={tier.tierId} id={`tier-p-${tier.tierId}`} />
                                                        <span className="text-[10px] md:text-[11px] font-black uppercase tracking-tight">{tier.name}</span>
                                                    </div>
                                                    <span className="font-black text-primary text-[10px] md:text-xs font-mono">${tier.price.toFixed(2)}</span>
                                                </label>
                                            ))}
                                        </RadioGroup>
                                    )}
                                />
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                <div className="space-y-6 pt-6 border-t border-dashed">
                    <h3 className="text-base md:text-lg font-black uppercase tracking-tight flex items-center gap-3">
                        <CalendarCheck className="w-5 h-5 md:w-6 md:h-6 text-primary" />
                        Timing
                    </h3>
                    <div className="space-y-3 text-left">
                        <Label className="text-[9px] md:text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Schedule Picker</Label>
                        <div className="rounded-[2.5rem] border-2 bg-muted/10 p-4 md:p-6 space-y-6 md:space-y-8 shadow-inner">
                            <div className="flex justify-between items-center px-2">
                                <Button variant="outline" size="icon" onClick={() => setValue('date', subWeeks(date, 1))} type="button" className="h-8 w-8 md:h-10 md:w-10 rounded-full bg-background shadow-md border-none"><ChevronLeft className="w-4 h-4 md:w-5 md:h-5" /></Button>
                                <span className="font-black uppercase tracking-widest text-xs md:text-sm">{format(date, 'MMMM yyyy')}</span>
                                <Button variant="outline" size="icon" onClick={() => setValue('date', addWeeks(date, 1))} type="button" className="h-8 w-8 md:h-10 md:w-10 rounded-full bg-background shadow-md border-none"><ChevronRight className="w-4 h-4 md:w-5 md:h-5" /></Button>
                            </div>
                            <div className="grid grid-cols-7 gap-1.5 md:gap-3">
                                {weekDays.map(day => (
                                    <button 
                                        key={day.toISOString()} 
                                        onClick={() => setValue('date', day)} 
                                        disabled={isBefore(day, startOfDay(new Date())) && !isToday(day)} 
                                        className={cn(
                                            "flex flex-col items-center justify-center p-2 md:p-3 rounded-xl md:rounded-2xl border-2 transition-all aspect-square", 
                                            isSameDay(day, date) ? "bg-primary text-primary-foreground border-primary shadow-2xl scale-110" : "bg-background border-transparent hover:border-primary/30", 
                                            (isBefore(day, startOfDay(new Date())) && !isToday(day)) && "opacity-20 cursor-not-allowed"
                                        )} 
                                        type="button"
                                    >
                                        <span className="text-[8px] md:text-[10px] uppercase font-black opacity-60 mb-0.5 md:mb-1">{format(day, 'EEE')}</span>
                                        <span className="font-black text-sm md:text-xl tracking-tighter">{format(day, 'd')}</span>
                                    </button>
                                ))}
                            </div>
                            <div className="grid grid-cols-3 gap-2 md:gap-3 pt-6 md:pt-8 border-t-2 border-dashed border-white/50">
                                {timeSlots.map(time => (
                                    <Button 
                                        key={time} 
                                        variant={startTime === time ? 'default' : 'outline'} 
                                        onClick={() => setValue('startTime', time)} 
                                        type="button"
                                        className={cn(
                                            "h-10 md:h-14 font-black uppercase text-[10px] md:text-xs tracking-widest rounded-xl md:rounded-2xl border-2 transition-all", 
                                            startTime === time ? "shadow-2xl shadow-primary/20 scale-105" : "bg-background"
                                        )}
                                    >
                                        {format(timeStringToDate(time, new Date()), 'h:mm a')}
                                    </Button>
                                ))}
                                {timeSlots.length === 0 && (<div className="col-span-full text-center text-[9px] md:text-[10px] font-black uppercase tracking-widest text-muted-foreground/40 py-10 md:py-12 border-2 border-dashed rounded-[2rem]">No Availability</div>)}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <AlertDialog open={showConfirmation} onOpenChange={setShowConfirmation}>
                <AlertDialogContent className="rounded-[3rem] border-4 shadow-3xl">
                    <AlertDialogHeader className="p-6 pb-0 text-center sm:text-left">
                        <AlertDialogTitle className="font-black uppercase tracking-tighter text-xl md:text-2xl">Confirm Logic Violation</AlertDialogTitle>
                        <AlertDialogDescription className="font-bold text-sm text-slate-600 leading-relaxed uppercase text-left">
                            This manual override results in a schedule conflict. Force this record into the agenda?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="p-6 pt-4 flex flex-col gap-3">
                        <Button onClick={handleSubmit(confirmAndSubmit)} className="w-full h-16 rounded-2xl font-black uppercase tracking-widest shadow-2xl shadow-primary/20">Book Anyway</Button>
                        <AlertDialogCancel onClick={() => setShowConfirmation(false)} className="w-full h-10 md:h-12 rounded-xl font-bold uppercase text-[9px] md:text-[10px] tracking-widest border-none">Cancel</AlertDialogCancel>
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
  const dialogDescription = "Manually reserve a studio session for your guest.";
  
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
        <SheetContent side="bottom" className="h-[92dvh] flex flex-col p-0 border-none rounded-t-[2.5rem] bg-background shadow-2xl">
          <SheetHeader className="p-6 pb-4 border-b bg-muted/5 flex-shrink-0 text-left">
            <div className="flex items-center gap-2 mb-1.5">
                <Sparkles className="w-4 h-4 text-primary" />
                <span className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground">Planning Studio</span>
            </div>
            <SheetTitle className="text-xl font-black uppercase tracking-tighter text-slate-900 leading-none">{dialogTitle}</SheetTitle>
            <SheetDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">{dialogDescription}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto">
              <div className="px-6">{FormContent}</div>
          </div>
          <SheetFooter className="p-6 pt-4 border-t bg-background flex-shrink-0 shadow-2xl">
            <div className="flex w-full gap-3">
                <Button variant="ghost" onClick={() => onOpenChange(false)} className="h-12 font-black uppercase tracking-tighter text-[10px] text-slate-400">Cancel</Button>
                <Button type="submit" form="add-appointment-form" className="flex-[2.5] h-12 font-black uppercase tracking-widest text-[10px] rounded-2xl shadow-xl shadow-primary/20">Complete Booking</Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0 border-4 rounded-[3rem] overflow-hidden shadow-3xl bg-background">
         <DialogHeader className="p-10 pb-6 border-b bg-muted/5 text-left">
            <div className="flex items-center gap-3 mb-2">
                <Sparkles className="w-5 h-5 text-primary" />
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Planning Studio</span>
            </div>
            <DialogTitle className="text-4xl font-black uppercase tracking-tighter text-slate-900">{dialogTitle}</DialogTitle>
            <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60">{dialogDescription}</DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto">
            <div className="px-10">
                {FormContent}
            </div>
        </div>
        <DialogFooter className="p-10 pt-6 border-t bg-background">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="h-14 px-8 rounded-2xl font-bold uppercase tracking-tight">Cancel</Button>
          <Button type="submit" form="add-appointment-form" className="h-14 px-12 rounded-2xl font-black uppercase tracking-widest shadow-xl shadow-primary/20 active:scale-95 transition-all group">Book Appointment <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1"/></Button>
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