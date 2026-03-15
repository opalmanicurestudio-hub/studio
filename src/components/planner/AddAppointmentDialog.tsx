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
import { Progress } from '@/components/ui/progress';
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
  ArrowRight,
  Loader,
  Unlock,
  CheckCircle2,
  ShieldCheck,
  CreditCard,
  Banknote,
  Info
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Client, Service, Appointment, Staff, Event, InventoryItem, PricingTier, getServicePrice, Membership } from '@/lib/data';
import { format, setHours, setMinutes, startOfDay, areIntervalsOverlapping, addMinutes, startOfWeek, addDays, subWeeks, addWeeks, eachDayOfInterval, isSameDay, isBefore, isToday, addMonths, parseISO, endOfDay } from 'date-fns';
import { Card, CardContent } from '../ui/card';
import { nanoid } from 'nanoid';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { useForm, Controller, FormProvider, useFormContext } from 'react-hook-form';
import { Switch } from '../ui/switch';
import { useToast } from '@/hooks/use-toast';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { collection, query, where, doc, writeBatch, increment, arrayUnion } from 'firebase/firestore';
import { Badge } from '../ui/badge';
import { motion, AnimatePresence } from 'framer-motion';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { StaffSelectionCard } from '../shared/StaffSelectionCard';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { PhoneInput } from '../ui/phone-input';

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

type Step = 'details' | 'assignment' | 'timing' | 'deposit' | 'success';

export interface AddAppointmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (appointmentData: any) => void;
  client?: Client | null;
  appointmentToRebook?: Appointment | null;
  memberships: Membership[];
}

export const AddAppointmentDialog: React.FC<AddAppointmentDialogProps> = ({ open, onOpenChange, onConfirm, client: initialClient, appointmentToRebook, memberships }) => {
  const isMobile = useIsMobile();
  const { firestore, user } = useFirebase();
  const { selectedTenant, role } = useTenant();
  const { services, staff: allStaff, pricingTiers, clients, scheduleProfiles, appointments: appointmentsFromDB, events: eventsFromDB } = useInventory();
  const { toast } = useToast();
  const tenantId = selectedTenant?.id;
  const tmhr = selectedTenant?.tmhr || 50;

  const [step, setStep] = useState<Step>('details');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [assignedStaffId, setAssignedStaffId] = useState<string | null>(null);

  const methods = useForm({
    defaultValues: {
        clientId: '',
        serviceId: '',
        staffId: 'any',
        selectedTierId: 'any',
        date: new Date(),
        startTime: '',
        addOnIds: [] as string[],
        overrideBusinessHours: false,
        paymentMethod: 'card_on_file',
    }
  });

  const { register, handleSubmit, control, watch, reset, setValue, trigger } = methods;

  useEffect(() => {
    if (open) {
        setStep('details');
        setIsSubmitting(false);
        setAssignedStaffId(null);
        const staffDefault = (role === 'staff' && user) ? user.uid : (appointmentToRebook ? (appointmentToRebook.staffId || 'any') : 'any');
        reset({
            clientId: initialClient?.id || appointmentToRebook?.clientId || '',
            serviceId: appointmentToRebook ? appointmentToRebook.serviceId : '',
            staffId: staffDefault,
            selectedTierId: 'any',
            date: appointmentToRebook ? new Date(appointmentToRebook.startTime) : new Date(),
            startTime: appointmentToRebook ? format(new Date(appointmentToRebook.startTime), 'HH:mm') : '',
            addOnIds: appointmentToRebook ? (appointmentToRebook.addOnIds || []) : [],
            overrideBusinessHours: false,
            paymentMethod: 'card_on_file',
        });
    }
  }, [open, initialClient, appointmentToRebook, reset, role, user]);

  const watchClientId = watch('clientId');
  const watchServiceId = watch('serviceId');
  const watchStaffId = watch('staffId');
  const watchDate = watch('date');
  const watchStartTime = watch('startTime');
  const watchTierId = watch('selectedTierId');
  const watchOverride = watch('overrideBusinessHours');

  const selectedClient = useMemo(() => clients?.find(c => c.id === watchClientId), [clients, watchClientId]);
  const selectedService = useMemo(() => services?.find(s => s.id === watchServiceId), [services, watchServiceId]);
  const publicScheduleProfile = useMemo(() => scheduleProfiles?.find(p => p.isActive), [scheduleProfiles]);

  const qualifiedStaff = useMemo(() => {
    if (!selectedService?.requiredSkills || selectedService.requiredSkills.length === 0) return allStaff;
    return (allStaff || []).filter(s => selectedService.requiredSkills!.every(skill => (s.skillSet || []).includes(skill)));
  }, [selectedService, allStaff]);

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
  
  const weekStart = useMemo(() => startOfWeek(watchDate, { weekStartsOn: 0 }), [watchDate]);
  const weekDays = useMemo(() => eachDayOfInterval({ start: weekStart, end: addDays(weekStart, 6) }), [weekStart]);

  const timeSlots = useMemo(() => {
    if (!selectedService || !watchDate || !publicScheduleProfile || !allStaff || !services || !appointmentsFromDB) return [];
    const bookingInterval = publicScheduleProfile.bookingSlotInterval || 15;
    const dayName = format(watchDate, 'eeee').toLowerCase();
    
    let staffToAudit = watchStaffId === 'any' ? qualifiedStaff : qualifiedStaff.filter(s => s.id === watchStaffId);
    if (watchStaffId === 'any' && watchTierId !== 'any') {
        staffToAudit = staffToAudit.filter(s => s.pricingTierId === watchTierId);
    }

    const options: Set<string> = new Set();
    staffToAudit.forEach(staffMember => {
        let workingHours;
        const staffDaySchedule = staffMember?.availability?.week?.[dayName as keyof typeof staffMember.availability.week];
        if (staffDaySchedule?.enabled) workingHours = staffDaySchedule;
        else if (staffDaySchedule && !staffDaySchedule.enabled && !watchOverride) return;
        else workingHours = publicScheduleProfile?.week?.[dayName];
        
        const dayStartWithBusinessHours = watchOverride ? startOfDay(watchDate) : timeStringToDate(workingHours?.start || '09:00 AM', watchDate);
        const dayEndWithBusinessHours = watchOverride ? endOfDay(watchDate) : timeStringToDate(workingHours?.end || '05:00 PM', watchDate);
        
        if (!watchOverride && (!workingHours || !workingHours.enabled)) return;

        const busyIntervals: { start: Date, end: Date }[] = [];
        appointmentsFromDB.filter(apt => isSameDay(safeDate(apt.startTime), watchDate) && apt.staffId === staffMember.id).forEach(apt => {
            const aptService = services.find(s => s.id === apt.serviceId);
            busyIntervals.push({ start: addMinutes(safeDate(apt.startTime), -(aptService?.padBefore || 0)), end: addMinutes(safeDate(apt.endTime), (aptService?.padAfter || 0)) });
        });

        (eventsFromDB || []).filter(evt => isSameDay(safeDate(evt.startTime), watchDate) && evt.type === 'blocked' && (!evt.staffIds || evt.staffIds.includes('all') || evt.staffIds.includes(staffMember.id))).forEach(evt => {
            busyIntervals.push({ start: safeDate(evt.startTime), end: safeDate(evt.endTime) });
        });

        let currentTime = dayStartWithBusinessHours;
        const now = new Date();
        if (isToday(watchDate)) {
            const minSinceStart = (now.getHours() * 60) + now.getMinutes();
            const busStartMin = (currentTime.getHours() * 60) + currentTime.getMinutes();
            const skip = Math.ceil((minSinceStart - busStartMin) / bookingInterval);
            if (skip > 0) currentTime = addMinutes(dayStartWithBusinessHours, skip * bookingInterval);
        }
        
        while (currentTime < dayEndWithBusinessHours) {
            const potentialEnd = addMinutes(currentTime, selectedService.duration + (selectedService.padBefore || 0) + (selectedService.padAfter || 0));
            if (potentialEnd > dayEndWithBusinessHours) break;
            const isOverlapping = busyIntervals.some((interval) => areIntervalsOverlapping({ start: currentTime, end: potentialEnd }, interval, { inclusive: false }));
            if (!isOverlapping && (watchOverride || (!isToday(watchDate) || (staffMember.active && !staffMember.onBreak)))) {
                options.add(format(currentTime, 'HH:mm'));
            }
            currentTime = addMinutes(currentTime, bookingInterval);
        }
    });
    return Array.from(options).sort();
  }, [watchDate, watchStaffId, watchTierId, qualifiedStaff, selectedService, allStaff, appointmentsFromDB, eventsFromDB, publicScheduleProfile, services, watchOverride]);

  const depositDetails = useMemo(() => {
    if (!selectedService || selectedService.depositType === 'none') return null;
    const price = selectedService.price;
    let amount = 0;
    if (selectedService.depositType === 'full') amount = price;
    else if (selectedService.depositType === 'breakeven') amount = selectedService.cost;
    else {
        if (selectedService.depositSubType === 'percentage') amount = price * ((selectedService.depositAmount || 0) / 100);
        else amount = selectedService.depositAmount || 0;
    }
    return { amount: Math.ceil(amount), type: selectedService.depositType };
  }, [selectedService]);

  const handleNext = async () => {
    if (step === 'details') {
        const valid = await trigger(['clientId', 'serviceId']);
        if (valid) setStep('assignment');
    } else if (step === 'assignment') {
        setStep('timing');
    } else if (step === 'timing') {
        if (!watchStartTime) return toast({ variant: 'destructive', title: "Select Time", description: "A valid session window must be selected." });
        if (depositDetails) setStep('deposit');
        else finalizeBooking();
    } else if (step === 'deposit') {
        finalizeBooking();
    }
  };

  const finalizeBooking = async () => {
    setIsSubmitting(true);
    const data = methods.getValues();
    const [hours, minutes] = data.startTime.split(':').map(Number);
    const startDateTime = setMinutes(setHours(startOfDay(data.date), hours), minutes);
    const endDateTime = addMinutes(startDateTime, selectedService!.duration);

    let finalStaffId = data.staffId;
    if (finalStaffId === 'any') {
        const candidates = qualifiedStaff.filter(s => {
            const dayName = format(startDateTime, 'eeee').toLowerCase();
            const sched = s.availability?.week?.[dayName as keyof typeof s.availability.week] || publicScheduleProfile?.week?.[dayName];
            if (!data.overrideBusinessHours) {
                if (!sched?.enabled) return false;
                const openT = timeStringToDate(sched.start, startDateTime);
                const closeT = timeStringToDate(sched.end, startDateTime);
                if (startDateTime < openT || endDateTime > closeT) return false;
            }
            return !appointmentsFromDB?.some(apt => apt.staffId === s.id && apt.status !== 'cancelled' && areIntervalsOverlapping({ start: startDateTime, end: endDateTime }, { start: safeDate(apt.startTime), end: safeDate(apt.endTime) }, { inclusive: false }));
        });
        if (candidates.length > 0) {
            candidates.sort((a, b) => (a.lastServedTimestamp ? parseISO(a.lastServedTimestamp).getTime() : 0) - (b.lastServedTimestamp ? parseISO(b.lastServedTimestamp).getTime() : 0));
            finalStaffId = candidates[0].id;
        } else {
            setIsSubmitting(false);
            return toast({ variant: 'destructive', title: 'Operational Conflict', description: 'No pros available for this specific window.' });
        }
    }

    setAssignedStaffId(finalStaffId);
    
    // Batch write for security and consistency
    const batch = writeBatch(firestore!);
    const aptId = nanoid();
    const token = nanoid(16);
    const aptRef = doc(firestore!, `tenants/${tenantId}/appointments`, aptId);
    const checkInRef = doc(firestore!, 'appointmentCheckIns', token);

    const payload = {
        id: aptId,
        tenantId,
        clientId: data.clientId,
        clientName: selectedClient?.name,
        serviceId: data.serviceId,
        staffId: finalStaffId,
        startTime: startDateTime.toISOString(),
        endTime: endDateTime.toISOString(),
        status: 'confirmed',
        source: 'manual',
        checkInToken: token,
        checkInStatus: 'pending'
    };

    batch.set(aptRef, payload);
    batch.set(checkInRef, payload);

    if (depositDetails && data.paymentMethod !== 'none') {
        const txnRef = doc(collection(firestore!, `tenants/${tenantId}/transactions`));
        batch.set(txnRef, {
            id: txnRef.id,
            date: new Date().toISOString(),
            description: `Retainer: ${selectedService?.name}`,
            clientOrVendor: selectedClient?.name,
            clientId: data.clientId,
            type: 'income',
            context: 'Business',
            category: 'Retainers',
            amount: depositDetails.amount,
            paymentMethod: data.paymentMethod === 'card_on_file' ? 'Vault' : 'Manual Entry',
            appointmentId: aptId,
            staffId: finalStaffId
        });
    }

    try {
        await batch.commit();
        setStep('success');
    } catch (e) {
        toast({ variant: 'destructive', title: 'Registry Error' });
    } finally {
        setIsSubmitting(false);
    }
  };

  const currentAssignedPro = useMemo(() => allStaff?.find(s => s.id === assignedStaffId), [allStaff, assignedStaffId]);

  const SelectionHeader = ({ icon: Icon, title, stepNum }: { icon: any, title: string, stepNum: number }) => (
    <div className="flex items-center gap-4 mb-8 text-left">
        <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shadow-inner border border-primary/20 shrink-0">
            <Icon className="w-5 h-5" />
        </div>
        <div className="space-y-0.5">
            <p className="text-[9px] font-black uppercase tracking-widest text-primary/60">Module {stepNum}</p>
            <h3 className="text-xl font-black uppercase tracking-tighter text-slate-900">{title}</h3>
        </div>
    </div>
  );

  const hasCardOnFile = !!selectedClient?.cardOnFile?.token;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={isMobile ? "bottom" : "right"} className={cn("p-0 border-none bg-background flex flex-col shadow-3xl overflow-hidden", isMobile ? "h-[92dvh] rounded-t-[2.5rem]" : "sm:max-w-xl max-h-[95dvh]")}>
        <SheetHeader className="p-8 pb-6 border-b bg-muted/5 flex-shrink-0 text-left">
            <div className="flex items-center gap-3 mb-2">
                <Sparkles className="w-5 h-5 text-primary" />
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Strategic Intake</span>
            </div>
            <SheetTitle className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">Register Session</SheetTitle>
            {step !== 'success' && <div className="pt-6"><Progress value={(['details', 'assignment', 'timing', 'deposit'].indexOf(step) + 1) / (depositDetails ? 4 : 3) * 100} className="h-1 rounded-full bg-muted" /></div>}
        </SheetHeader>

        <ScrollArea className="flex-1">
            <div className="p-8">
                <AnimatePresence mode="wait">
                    {step === 'details' && (
                        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} key="details" className="space-y-10">
                            <SelectionHeader icon={User} title="Guest & Protocol" stepNum={1} />
                            <div className="space-y-6 text-left">
                                <div className="space-y-3">
                                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Guest Identification</Label>
                                    <Controller
                                        name="clientId"
                                        control={control}
                                        render={({ field }) => (
                                            <Select onValueChange={field.onChange} value={field.value}>
                                                <SelectTrigger className="h-14 rounded-2xl border-2 shadow-inner bg-muted/5 font-black uppercase text-xs tracking-tight">
                                                    <SelectValue placeholder="SEARCH ROSTER..." />
                                                </SelectTrigger>
                                                <SelectContent className="rounded-xl border-2 shadow-2xl">
                                                    {(clients || []).map(c => <SelectItem key={c.id} value={c.id} className="font-bold uppercase text-[10px] tracking-widest">{c.name}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                        )}
                                    />
                                </div>
                                <div className="space-y-3">
                                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Service Matrix</Label>
                                    <Controller
                                        name="serviceId"
                                        control={control}
                                        render={({ field }) => (
                                            <Select onValueChange={field.onChange} value={field.value}>
                                                <SelectTrigger className="h-14 rounded-2xl border-2 shadow-inner bg-muted/5 font-black uppercase text-xs tracking-tight">
                                                    <SelectValue placeholder="SELECT TREATMENT..." />
                                                </SelectTrigger>
                                                <SelectContent className="rounded-xl border-2 shadow-2xl">
                                                    {(services || []).filter(s => s.type === 'service').map(s => <SelectItem key={s.id} value={s.id} className="font-bold uppercase text-[10px] tracking-widest">{s.name}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                        )}
                                    />
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {step === 'assignment' && (
                        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} key="assignment" className="space-y-10">
                            <SelectionHeader icon={Users} title="Provider Routing" stepNum={2} />
                            <Controller
                                name="staffId"
                                control={control}
                                render={({ field }) => (
                                    <RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 gap-4">
                                        <StaffSelectionCard 
                                            staff={{ id: 'any', name: 'Smart Rotation', avatarUrl: '' }} 
                                            pricingTiers={pricingTiers || []} 
                                            isSelected={field.value === 'any'}
                                        />
                                        {(staff || []).map(s => (
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
                        </motion.div>
                    )}

                    {step === 'timing' && (
                        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} key="timing" className="space-y-10">
                            <div className="flex items-center justify-between">
                                <SelectionHeader icon={Clock} title="Schedule Window" stepNum={3} />
                                <div className="flex items-center gap-2 p-2 bg-muted/20 rounded-xl">
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <div className="flex items-center gap-2">
                                                    <Unlock className={cn("w-3.5 h-3.5 transition-colors", watchOverride ? "text-primary" : "text-muted-foreground opacity-40")} />
                                                    <Switch checked={watchOverride} onCheckedChange={(val) => setValue('overrideBusinessHours', val)} />
                                                </div>
                                            </TooltipTrigger>
                                            <TooltipContent className="font-black uppercase text-[9px] tracking-widest border-2">Override Lock</TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                </div>
                            </div>
                            <div className="rounded-[2.5rem] border-2 bg-muted/10 p-6 space-y-8 shadow-inner text-center">
                                <div className="flex justify-between items-center px-2">
                                    <Button variant="outline" size="icon" onClick={() => setValue('date', subWeeks(watchDate, 1))} type="button" className="h-10 w-10 rounded-full bg-background shadow-md border-none"><ChevronLeft className="w-5 h-5" /></Button>
                                    <span className="font-black uppercase tracking-widest text-sm">{format(watchDate, 'MMMM yyyy')}</span>
                                    <Button variant="outline" size="icon" onClick={() => setValue('date', addWeeks(watchDate, 1))} type="button" className="h-10 w-10 rounded-full bg-background shadow-md border-none"><ChevronRight className="w-5 h-5" /></Button>
                                </div>
                                <div className="grid grid-cols-7 gap-2">
                                    {weekDays.map(day => (
                                        <button key={day.toISOString()} onClick={() => setValue('date', day)} className={cn("flex flex-col items-center justify-center p-3 rounded-2xl border-2 transition-all aspect-square", isSameDay(day, watchDate) ? "bg-primary text-primary-foreground border-primary shadow-2xl scale-110" : "bg-background border-transparent hover:border-primary/30")}>
                                            <span className="text-[10px] uppercase font-black opacity-60 mb-1">{format(day, 'E')}</span>
                                            <span className="font-black text-xl tracking-tighter">{format(day, 'd')}</span>
                                        </button>
                                    ))}
                                </div>
                                <div className="grid grid-cols-3 gap-3 pt-8 border-t-2 border-dashed border-white/50">
                                    {timeSlots.map(time => (
                                        <Button key={time} variant={watchStartTime === time ? 'default' : 'outline'} onClick={() => setValue('startTime', time)} className={cn("h-14 font-black uppercase text-xs tracking-widest rounded-2xl border-2 transition-all", watchStartTime === time ? "shadow-2xl shadow-primary/20 scale-105" : "bg-background")}>
                                            {format(timeStringToDate(time, new Date()), 'h:mm a')}
                                        </Button>
                                    ))}
                                    {timeSlots.length === 0 && <div className="col-span-full py-12 text-[10px] font-black uppercase text-muted-foreground/40 border-2 border-dashed rounded-3xl">No Availability</div>}
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {step === 'deposit' && depositDetails && (
                        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} key="deposit" className="space-y-10">
                            <SelectionHeader icon={CreditCard} title="Secure Retainer" stepNum={4} />
                            <div className="p-10 rounded-[3rem] bg-primary/5 border-4 border-primary/10 text-center space-y-4 shadow-2xl shadow-primary/5">
                                <p className="text-[10px] font-black uppercase text-primary/60 tracking-[0.3em]">Required Deposit</p>
                                <p className="text-7xl font-black text-primary tracking-tighter font-mono">${depositDetails.amount.toFixed(2)}</p>
                                <div className="pt-4 border-t border-primary/10">
                                    <Badge variant="outline" className="bg-white border-2 text-primary font-black uppercase text-[9px] h-6 px-3">{depositDetails.type.toUpperCase()} RECOVERY</Badge>
                                </div>
                            </div>
                            <div className="space-y-4 text-left">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Settlement Mode</Label>
                                <Controller
                                    name="paymentMethod"
                                    control={control}
                                    render={({ field }) => (
                                        <RadioGroup value={field.value} onValueChange={field.onChange} className="grid grid-cols-1 gap-3">
                                            <label htmlFor="pay-vault" className={cn("flex items-center justify-between p-5 rounded-2xl border-2 cursor-pointer transition-all hover:bg-muted/50", !hasCardOnFile && "opacity-40 grayscale grayscale-[0.5]")}>
                                                <div className="flex items-center gap-4">
                                                    <RadioGroupItem value="card_on_file" id="pay-vault" disabled={!hasCardOnFile}/>
                                                    <div className="space-y-0.5">
                                                        <span className="text-sm font-black uppercase tracking-tight text-slate-900">Vaulted Card</span>
                                                        <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">{hasCardOnFile ? `${selectedClient?.cardOnFile?.brand} •••• ${selectedClient?.cardOnFile?.last4}` : 'No secure card archived'}</p>
                                                    </div>
                                                </div>
                                                <ShieldCheck className={cn("w-5 h-5", hasCardOnFile ? "text-primary" : "text-slate-300")} />
                                            </label>
                                            <label htmlFor="pay-terminal" className="flex items-center justify-between p-5 rounded-2xl border-2 cursor-pointer transition-all hover:bg-muted/50 border-border">
                                                <div className="flex items-center gap-4">
                                                    <RadioGroupItem value="terminal" id="pay-terminal" />
                                                    <div className="space-y-0.5">
                                                        <span className="text-sm font-black uppercase tracking-tight text-slate-900">Terminal Entry</span>
                                                        <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">Authorize new card via terminal</p>
                                                    </div>
                                                </div>
                                                <Zap className="w-5 h-5 text-primary" />
                                            </label>
                                            <label htmlFor="pay-pending" className="flex items-center justify-between p-5 rounded-2xl border-2 border-dashed cursor-pointer transition-all hover:bg-muted/50">
                                                <div className="flex items-center gap-4">
                                                    <RadioGroupItem value="none" id="pay-pending" />
                                                    <div className="space-y-0.5">
                                                        <span className="text-sm font-black uppercase tracking-tight text-slate-900">Arrears Allocation</span>
                                                        <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">Add to dossier for future settlement</p>
                                                    </div>
                                                </div>
                                                <Landmark className="w-5 h-5 text-muted-foreground opacity-40" />
                                            </label>
                                        </RadioGroup>
                                    )}
                                />
                            </div>
                        </motion.div>
                    )}

                    {step === 'success' && (
                        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} key="success" className="text-center py-12 space-y-12">
                            <div className="w-32 h-32 bg-green-500/10 rounded-[3rem] flex items-center justify-center mx-auto shadow-2xl shadow-green-500/5 rotate-6">
                                <CheckCircle2 className="w-16 h-16 text-green-500 -rotate-6" />
                            </div>
                            <div className="space-y-3">
                                <h2 className="text-4xl font-black uppercase tracking-tighter text-slate-900">Registry Entry Finalized</h2>
                                <p className="text-muted-foreground font-medium max-w-xs mx-auto leading-relaxed">The session has been successfully pinned to the studio manifest.</p>
                            </div>
                            
                            <div className="grid gap-6 max-w-sm mx-auto">
                                <Card className="p-6 rounded-[2.5rem] border-2 bg-white shadow-2xl flex flex-col items-center gap-4 text-left">
                                    <p className="text-[9px] font-black uppercase tracking-widest text-primary">Assigned Professional</p>
                                    <div className="flex items-center gap-4 w-full">
                                        <Avatar className="w-16 h-16 border-4 border-background shadow-xl rounded-2xl">
                                            <AvatarImage src={currentAssignedPro?.avatarUrl} className="object-cover" />
                                            <AvatarFallback className="bg-primary/10 text-primary font-black uppercase">{(currentAssignedPro?.name || 'S')[0]}</AvatarFallback>
                                        </Avatar>
                                        <div className="min-w-0 flex-1">
                                            <p className="font-black text-xl uppercase tracking-tight leading-none mb-1 truncate">{currentAssignedPro?.name}</p>
                                            <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">{currentAssignedPro?.role}</p>
                                        </div>
                                    </div>
                                </Card>
                                <Card className="p-6 rounded-[2rem] border-2 border-dashed bg-muted/10 space-y-4 text-left shadow-inner">
                                    <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground text-center">Session Intel</p>
                                    <div className="flex items-center gap-4">
                                        <CalendarIcon className="w-5 h-5 text-primary opacity-40" />
                                        <div className="space-y-0.5">
                                            <p className="font-black uppercase text-xs">{format(watchDate, 'EEEE, MMM d')}</p>
                                            <p className="text-sm font-black text-primary tracking-tighter font-mono">{format(timeStringToDate(watchStartTime, new Date()), 'h:mm a')}</p>
                                        </div>
                                    </div>
                                    <div className="pt-4 border-t border-white/50 flex items-center gap-4">
                                        <Sparkles className="w-5 h-5 text-primary opacity-40" />
                                        <p className="font-black uppercase text-xs truncate">{selectedService?.name}</p>
                                    </div>
                                </Card>
                            </div>
                            
                            <Button className="w-full h-16 text-lg font-black uppercase tracking-widest rounded-3xl shadow-3xl shadow-primary/20 transition-all active:scale-95" onClick={() => onOpenChange(false)}>Return to Agenda</Button>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </ScrollArea>

        <SheetFooter className="p-8 pt-4 border-t bg-background flex-shrink-0 shadow-2xl">
            {step !== 'success' && (
                <div className="flex w-full gap-4">
                    {step !== 'details' && (
                        <Button variant="ghost" onClick={() => setStep(prev => prev === 'assignment' ? 'details' : prev === 'timing' ? 'assignment' : 'timing')} className="h-14 font-black uppercase tracking-tighter text-xs text-slate-400 flex-1">Back</Button>
                    )}
                    <Button 
                        onClick={handleNext} 
                        disabled={isSubmitting || !watchClientId || !watchServiceId}
                        className={cn("h-14 rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-primary/20 group transition-all", step === 'details' ? "w-full" : "flex-[2.5]")}
                    >
                        {isSubmitting ? <Loader className="animate-spin h-5 w-5" /> : (
                            <>
                                {step === 'details' ? 'Provider Routing' : step === 'assignment' ? 'Select Window' : step === 'timing' && depositDetails ? 'Deposit Settlement' : 'Finalize Booking'}
                                <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1" />
                            </>
                        )}
                    </Button>
                </div>
            )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};
