'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { Card, CardContent } from '../ui/card';
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
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { 
  Calendar as CalendarIcon, 
  PlusCircle, 
  ChevronLeft, 
  ChevronRight, 
  User, 
  Award, 
  Clock, 
  Users, 
  Sparkles, 
  ArrowRight, 
  Check, 
  Search,
  ShieldCheck,
  CreditCard,
  Zap,
  Landmark,
  Wallet,
  CheckCircle2,
  Repeat,
  Info,
  Unlock,
  UserPlus,
  Loader,
  Smartphone,
  Mail,
  Cake,
  Star,
  FileImage
} from 'lucide-react';
import { cn, safeNumber } from '@/lib/utils';
import { type Client, type Service, type Appointment, type Staff, type PricingTier } from '@/lib/data';
import { format, setHours, setMinutes, startOfDay, areIntervalsOverlapping, addMinutes, startOfWeek, addDays, subWeeks, addWeeks, eachDayOfInterval, isSameDay, isBefore, isToday, parseISO, endOfDay } from 'date-fns';
import { nanoid } from 'nanoid';
import { useForm, Controller, FormProvider } from 'react-hook-form';
import { Switch } from '../ui/switch';
import { useToast } from '@/hooks/use-toast';
import { useFirebase, useUser } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { collection, doc, writeBatch, increment, arrayUnion, query, where, getDocs } from 'firebase/firestore';
import { Badge } from '../ui/badge';
import { motion, AnimatePresence } from 'framer-motion';
import { StaffSelectionCard } from '../shared/StaffSelectionCard';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { PhoneInput } from '../ui/phone-input';
import { ImageUpload } from '../shared/ImageUpload';

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

type Step = 'details' | 'assignment' | 'timing' | 'deposit' | 'success';

export const AddAppointmentDialog: React.FC<any> = ({ open, onOpenChange, client: initialClient, appointmentToRebook }) => {
  const isMobile = useIsMobile();
  const { firestore } = useFirebase();
  const { user } = useUser();
  const { selectedTenant, role } = useTenant();
  const { services, staff, pricingTiers, clients, scheduleProfiles, appointments: appointmentsFromDB, events: eventsFromDB } = useInventory();
  const { toast } = useToast();
  const tenantId = selectedTenant?.id;

  const [step, setStep] = useState<Step>('details');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [assignedStaffId, setAssignedStaffId] = useState<string | null>(null);
  const [clientSearch, setClientSearch] = useState('');
  const [checkInToken, setCheckInToken] = useState('');
  const [inspirationPhotoUrl, setInspirationPhotoUrl] = useState('');

  const methods = useForm({
    defaultValues: {
        clientId: '',
        newClientName: '',
        newClientEmail: '',
        newClientPhone: '',
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

  const { register, control, watch, reset, setValue, trigger, handleSubmit } = methods;

  useEffect(() => {
    if (open) {
        setStep('details');
        setIsSubmitting(false);
        setAssignedStaffId(null);
        setClientSearch('');
        setCheckInToken('');
        setInspirationPhotoUrl('');
        const staffDefault = (role === 'staff' && user) ? user.uid : (appointmentToRebook ? (appointmentToRebook.staffId || 'any') : 'any');
        reset({
            clientId: initialClient?.id || appointmentToRebook?.clientId || '',
            newClientName: '',
            newClientEmail: '',
            newClientPhone: '',
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
    if (!selectedService?.requiredSkills || selectedService.requiredSkills.length === 0) return staff || [];
    return (staff || []).filter(s => selectedService.requiredSkills!.every(skill => (s.skillSet || []).includes(skill)));
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
  
  const weekStart = useMemo(() => startOfWeek(watchDate, { weekStartsOn: 0 }), [watchDate]);
  const weekDays = useMemo(() => eachDayOfInterval({ start: weekStart, end: addDays(weekStart, 6) }), [weekStart]);

  const timeSlots = useMemo(() => {
    if (!selectedService || !watchDate || !publicScheduleProfile || !staff || !services || !appointmentsFromDB) return [];
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
        appointmentsFromDB.filter(apt => isSameDay(safeDate(apt.startTime), watchDate) && apt.staffId === staffMember.id && apt.status !== 'cancelled').forEach(apt => {
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
            const busStartMin = (dayStartWithBusinessHours.getHours() * 60) + dayStartWithBusinessHours.getMinutes();
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
  }, [watchDate, watchStaffId, watchTierId, qualifiedStaff, selectedService, staff, appointmentsFromDB, eventsFromDB, publicScheduleProfile, services, watchOverride]);

  const depositDetails = useMemo(() => {
    if (!selectedService || selectedService.depositType === 'none') return null;
    const price = selectedService.price;
    let amount = 0;
    if (selectedService.depositType === 'full') amount = price;
    else if (selectedService.depositType === 'breakeven') amount = selectedService.cost;
    else {
        if (selectedService.depositSubType === 'flat') amount = selectedService.depositAmount || 0;
        else amount = price * ((selectedService.depositAmount || 0) / 100);
    }
    return { amount: Math.ceil(amount), type: selectedService.depositType };
  }, [selectedService]);

  const steps = useMemo(() => {
    const flow: Step[] = ['details', 'assignment', 'timing'];
    if (depositDetails) flow.push('deposit');
    flow.push('success');
    return flow;
  }, [depositDetails]);

  const currentStepIndex = steps.indexOf(step);

  const handleNext = async () => {
    if (step === 'details') {
        const isNew = watchClientId === 'new';
        const fieldsToValidate: any[] = isNew ? ['newClientName', 'newClientEmail', 'serviceId'] : ['clientId', 'serviceId'];
        const valid = await trigger(fieldsToValidate);
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

  const handlePrevStep = () => {
    if (currentStepIndex > 0) {
      setStep(steps[currentStepIndex - 1]);
    }
  };

  const finalizeBooking = async () => {
    setIsSubmitting(true);
    const data = methods.getValues();
    const [hours, minutes] = data.startTime.split(':').map(Number);
    const startDateTime = setMinutes(setHours(startOfDay(data.date), hours), minutes);
    const endDateTime = addMinutes(startDateTime, selectedService!.duration);

    const batch = writeBatch(firestore!);
    const now = new Date().toISOString();
    
    let finalClientId = data.clientId;
    let finalClientName = selectedClient?.name || data.newClientName;

    if (finalClientId === 'new') {
        const newClientRef = doc(collection(firestore!, `tenants/${tenantId}/clients`));
        finalClientId = newClientRef.id;
        batch.set(newClientRef, {
            id: finalClientId,
            name: data.newClientName,
            email: data.newClientEmail,
            phone: data.newClientPhone,
            avatarUrl: `https://picsum.photos/seed/${finalClientId}/100`,
            lifetimeValue: 0,
            lastAppointment: now,
            status: 'active'
        });
    }

    let finalStaffId = data.staffId;
    if (finalStaffId === 'any') {
        const candidates = qualifiedStaff.filter(s => {
            const dayName = format(startDateTime, 'eeee').toLowerCase();
            const sDaySched = s.availability?.week?.[dayName as keyof typeof s.availability.week] || publicScheduleProfile?.week?.[dayName];
            if (!data.overrideBusinessHours) {
                if (!sDaySched?.enabled) return false;
                const openT = timeStringToDate(sDaySched.start, startDateTime);
                const closeT = timeStringToDate(sDaySched.end, startDateTime);
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
    
    const aptId = nanoid();
    const token = nanoid(16);
    setCheckInToken(token);
    const aptRef = doc(firestore!, `tenants/${tenantId}/appointments`, aptId);
    const checkInRef = doc(firestore!, 'appointmentCheckIns', token);

    const isRemotePayment = depositDetails && data.paymentMethod === 'none';

    const payload = {
        id: aptId,
        tenantId,
        clientId: finalClientId,
        clientName: finalClientName,
        serviceId: data.serviceId,
        staffId: finalStaffId,
        startTime: startDateTime.toISOString(),
        endTime: endDateTime.toISOString(),
        status: isRemotePayment ? 'deposit_pending' : 'confirmed',
        source: 'manual',
        checkInToken: token,
        checkInStatus: 'pending',
        cancellationFeeApplied: depositDetails?.amount || 0,
        inspirationPhotoUrl: inspirationPhotoUrl || undefined
    };

    batch.set(aptRef, payload);
    batch.set(checkInRef, payload);

    if (depositDetails && data.paymentMethod !== 'none') {
        const txnRef = doc(collection(firestore!, `tenants/${tenantId}/transactions`));
        batch.set(txnRef, {
            id: txnRef.id,
            date: now,
            description: `Retainer: ${selectedService?.name}`,
            clientOrVendor: finalClientName,
            clientId: finalClientId,
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
        if (isRemotePayment) {
            toast({ title: "Settlement Queued", description: "Payment link ready for guest dispatch." });
        }
    } catch (e) {
        toast({ variant: 'destructive', title: 'Registry Error' });
    } finally {
        setIsSubmitting(false);
    }
  };

  const handleCopyLink = () => {
    if (checkInToken) {
        const link = `${window.location.origin}/check-in/${checkInToken}`;
        navigator.clipboard.writeText(link);
        toast({ title: 'Portal Link Copied' });
    }
  };

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

  const filteredClients = useMemo(() => {
      if (!clients) return [];
      if (!clientSearch.trim()) return clients.slice(0, 10);
      const s = clientSearch.toLowerCase();
      return clients.filter(c => c.name.toLowerCase().includes(s) || (c.email && c.email.toLowerCase().includes(s)) || (c.phone && c.phone.includes(s)));
  }, [clients, clientSearch]);

  const currentAssignedPro = useMemo(() => staff?.find(s => s.id === assignedStaffId), [staff, assignedStaffId]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={isMobile ? "bottom" : "right"} className={cn("p-0 border-none bg-background flex flex-col shadow-3xl overflow-hidden", isMobile ? "h-[92dvh] rounded-t-[2.5rem]" : "sm:max-w-xl max-h-[95dvh]")}>
        <SheetHeader className={cn("p-8 pb-6 border-b bg-muted/5 flex-shrink-0 text-left", isMobile ? "p-6" : "p-8 pb-6")}>
            <div className="flex items-center gap-3 mb-2">
                <Sparkles className="w-5 h-5 text-primary" />
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Strategic Intake</span>
            </div>
            <SheetTitle className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">Register Session</SheetTitle>
            {step !== 'success' && <div className="pt-6"><Progress value={(currentStepIndex + 1) / (steps.length - 1) * 100} className="h-1 rounded-full bg-muted" /></div>}
        </SheetHeader>

        <ScrollArea className="flex-1">
            <div className="p-8 pb-32">
                <AnimatePresence mode="wait">
                    {step === 'details' && (
                        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -20 }} key="details" className="space-y-10">
                            <SelectionHeader icon={User} title="Guest & Protocol" stepNum={1} />
                            <div className="space-y-8 text-left">
                                <div className="space-y-3">
                                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Guest Identification</Label>
                                    <Controller
                                        name="clientId"
                                        control={control}
                                        render={({ field }) => (
                                            <div className="space-y-4">
                                                <div className="relative">
                                                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground opacity-40" />
                                                    <Input 
                                                        placeholder="SEARCH BY NAME, EMAIL, OR PHONE..." 
                                                        value={clientSearch}
                                                        onChange={e => setClientSearch(e.target.value)}
                                                        className="h-14 pl-12 rounded-2xl border-2 font-black uppercase text-xs shadow-inner"
                                                    />
                                                </div>
                                                <div className="grid grid-cols-1 gap-2">
                                                    <button 
                                                        type="button"
                                                        onClick={() => { field.onChange('new'); setClientSearch(''); }}
                                                        className={cn(
                                                            "flex items-center gap-4 p-4 rounded-2xl border-2 transition-all text-left",
                                                            field.value === 'new' ? "border-primary bg-primary/5 shadow-md" : "border-dashed hover:border-primary/20"
                                                        )}
                                                    >
                                                        <div className="p-3 bg-muted rounded-xl shadow-inner"><UserPlus className="w-5 h-5 text-muted-foreground" /></div>
                                                        <span className="font-black uppercase text-xs tracking-tight">Register New Profile</span>
                                                    </button>
                                                    {filteredClients.map(c => {
                                                        const isSel = field.value === c.id;
                                                        const isClientMember = !!(c.activeMembershipId || c.subscription);
                                                        const hasPkg = (c.activePackages?.length || 0) > 0;
                                                        const hasDebt = (c.outstandingBalance || 0) > 0;
                                                        return (
                                                            <button 
                                                                key={c.id}
                                                                type="button"
                                                                onClick={() => { field.onChange(c.id); setClientSearch(''); }}
                                                                className={cn(
                                                                    "flex items-center gap-4 p-4 rounded-2xl border-2 transition-all text-left",
                                                                    isSel ? "border-primary bg-primary/5 shadow-md" : "border-transparent bg-muted/10 hover:bg-muted/20"
                                                                )}
                                                            >
                                                                <div className="relative shrink-0">
                                                                    <Avatar className="h-10 w-10 border shadow-sm rounded-xl">
                                                                        <AvatarImage src={c.avatarUrl} className="object-cover" />
                                                                        <AvatarFallback className="font-black text-xs">{(c.name || 'G')[0]}</AvatarFallback>
                                                                    </Avatar>
                                                                    {isClientMember && <div className="absolute -top-1 -right-1 bg-indigo-600 text-white p-0.5 rounded shadow-sm border border-background"><Award className="w-2.5 h-2.5" /></div>}
                                                                </div>
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="flex items-center gap-2">
                                                                        <p className="font-black uppercase text-xs truncate leading-none text-left">{c.name}</p>
                                                                        {hasPkg && <Badge className="bg-teal-600 text-white border-none text-[7px] h-3.5 px-1 font-black uppercase">PKG</Badge>}
                                                                        {hasDebt && <Badge variant="destructive" className="border-none text-[7px] h-3.5 px-1 font-black uppercase animate-pulse">ARREARS</Badge>}
                                                                    </div>
                                                                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60 truncate text-left">{c.email || c.phone || 'No contact on file'}</p>
                                                                </div>
                                                                {isSel && <Check className="w-5 h-5 text-primary" />}
                                                            </button>
                                                        )
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                    />
                                </div>

                                {watchClientId === 'new' && (
                                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="space-y-6 p-6 rounded-[2rem] border-2 bg-muted/5 shadow-inner overflow-hidden">
                                        <div className="space-y-1.5">
                                            <Label className="text-[9px] font-black uppercase text-primary ml-1">Full Legal Name</Label>
                                            <Input {...register('newClientName')} placeholder="ALEXANDER SMITH" className="h-12 rounded-xl border-2 font-black uppercase text-sm bg-white" />
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div className="space-y-1.5">
                                                <Label className="text-[9px] font-black uppercase text-primary ml-1">Email</Label>
                                                <Input type="email" {...register('newClientEmail')} placeholder="alex@example.com" className="h-12 rounded-xl border-2 font-bold text-xs bg-white" />
                                            </div>
                                            <div className="space-y-1.5 kiosk-phone-input text-left">
                                                <Label className="text-[9px] font-black uppercase text-primary ml-1">Mobile</Label>
                                                <PhoneInput name="newClientPhone" label="" className="h-12" />
                                            </div>
                                        </div>
                                    </motion.div>
                                )}

                                <div className="space-y-3">
                                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Service Protocol</Label>
                                    <Controller
                                        name="serviceId"
                                        control={control}
                                        render={({ field }) => (
                                            <Select onValueChange={field.onChange} value={field.value}>
                                                <SelectTrigger id="service-add-apt" className="h-14 rounded-2xl border-2 shadow-inner bg-muted/5 font-black uppercase text-xs tracking-tight">
                                                    <SelectValue placeholder="SELECT TREATMENT..." />
                                                </SelectTrigger>
                                                <SelectContent className="rounded-xl border-2 shadow-2xl">
                                                    {(services || []).filter(s => s.type === 'service').map(s => <SelectItem key={s.id} value={s.id} className="font-bold uppercase text-[10px] tracking-widest">{s.name}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                        )}
                                    />
                                </div>

                                <div className="space-y-4 pt-4 border-t border-dashed">
                                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1 flex items-center gap-2">
                                        <FileImage className="w-3.5 h-3.5 opacity-40" /> Visual Reference
                                    </Label>
                                    <ImageUpload onImageUploaded={setInspirationPhotoUrl} initialImage={inspirationPhotoUrl} />
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {step === 'assignment' && (
                        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -20 }} key="assignment" className="space-y-10">
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
                        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -20 }} key="timing" className="space-y-10">
                            <div className="flex items-center justify-between">
                                <SelectionHeader icon={Clock} title="Schedule Window" stepNum={3} />
                                <div className="flex items-center gap-3 p-2 bg-muted/20 rounded-xl border-2 border-transparent">
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
                                <div className="flex items-center justify-between">
                                    <Button variant="outline" size="icon" onClick={() => setValue('date', subWeeks(watchDate, 1))} type="button" className="h-10 w-10 rounded-full bg-background shadow-md border-none"><ChevronLeft className="w-5 h-5" /></Button>
                                    <span className="font-black uppercase tracking-widest text-sm">{format(watchDate, 'MMMM yyyy')}</span>
                                    <Button variant="outline" size="icon" onClick={() => setValue('date', addWeeks(watchDate, 1))} type="button" className="h-10 w-10 rounded-full bg-background shadow-md border-none"><ChevronRight className="w-5 h-5" /></Button>
                                </div>
                                <div className="grid grid-cols-7 gap-2">
                                    {weekDays.map(day => (
                                        <button key={day.toISOString()} onClick={() => setValue('date', day)} className={cn("flex flex-col items-center justify-center p-3 rounded-2xl border-2 transition-all aspect-square", isSameDay(day, watchDate) ? "bg-primary text-primary-foreground border-primary shadow-2xl scale-110" : "bg-background border-transparent hover:border-primary/30", (isBefore(day, startOfDay(new Date())) && !isToday(day)) && "opacity-20 cursor-not-allowed")} type="button">
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
                        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -20 }} key="deposit" className="space-y-10">
                            <SelectionHeader icon={CreditCard} title="Secure Retainer" stepNum={4} />
                            <div className="p-10 rounded-[3rem] bg-primary/5 border-4 border-primary/10 text-center space-y-4 shadow-2xl shadow-primary/5">
                                <p className="text-[10px] font-black uppercase text-primary/60 tracking-[0.3em]">Required Deposit</p>
                                <p className="text-5xl font-black text-primary tracking-tighter font-mono">${depositDetails.amount.toFixed(2)}</p>
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
                                            <label htmlFor="pay-vault" className={cn("flex items-center justify-between p-5 rounded-2xl border-2 cursor-pointer transition-all hover:bg-muted/5", !selectedClient?.cardOnFile?.token && "opacity-40 grayscale grayscale-[0.5]")}>
                                                <div className="flex items-center gap-4">
                                                    <RadioGroupItem value="card_on_file" id="pay-vault" disabled={!selectedClient?.cardOnFile?.token}/>
                                                    <div className="space-y-0.5 text-left">
                                                        <span className="text-sm font-black uppercase tracking-tight text-slate-900">Vaulted Card</span>
                                                        <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">{selectedClient?.cardOnFile?.token ? `${selectedClient?.cardOnFile?.brand} •••• ${selectedClient?.cardOnFile?.last4}` : 'No secure card archived'}</p>
                                                    </div>
                                                </div>
                                                <ShieldCheck className={cn("w-5 h-5", selectedClient?.cardOnFile?.token ? "text-primary" : "text-slate-300")} />
                                            </label>
                                            <label htmlFor="pay-terminal" className="flex items-center justify-between p-5 rounded-2xl border-2 cursor-pointer transition-all hover:bg-muted/5 border-border">
                                                <div className="flex items-center gap-4">
                                                    <RadioGroupItem value="terminal" id="pay-terminal" />
                                                    <div className="space-y-0.5 text-left">
                                                        <span className="text-sm font-black uppercase tracking-tight text-slate-900">Terminal Entry</span>
                                                        <p className="text-[9px] font-bold text-muted-foreground uppercase font-bold tracking-tight opacity-60">Authorize new card via terminal</p>
                                                    </div>
                                                </div>
                                                <Zap className="w-5 h-5 text-primary" />
                                            </label>
                                            <label htmlFor="pay-pending" className="flex items-center justify-between p-5 rounded-2xl border-2 border-dashed cursor-pointer transition-all hover:bg-muted/5">
                                                <div className="flex items-center gap-4">
                                                    <RadioGroupItem value="none" id="pay-pending" />
                                                    <div className="space-y-0.5 text-left">
                                                        <span className="text-sm font-black uppercase tracking-tight text-slate-900">Remote Settlement Required</span>
                                                        <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">Guest pays via secure link before session</p>
                                                    </div>
                                                </div>
                                                <Smartphone className="w-5 h-5 text-muted-foreground opacity-40" />
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
                                <p className="text-muted-foreground font-medium max-w-xs mx-auto leading-relaxed text-center">The session has been successfully pinned to the studio manifest.</p>
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
                                            <p className="font-black text-xl uppercase tracking-tight leading-none mb-1 truncate text-left">{currentAssignedPro?.name}</p>
                                            <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-60 text-left">{currentAssignedPro?.role}</p>
                                        </div>
                                    </div>
                                </Card>
                                <Card className="p-6 rounded-[2rem] border-2 border-dashed bg-muted/10 space-y-4 text-left shadow-inner">
                                    <div className="flex items-center justify-between">
                                        <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Session Intel</p>
                                    </div>
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
                                    <div className="pt-4 border-t border-white/50 space-y-3">
                                        <p className="text-[9px] font-black uppercase text-primary">Remote Onboarding Protocol</p>
                                        <Button variant="outline" size="sm" onClick={handleCopyLink} className="w-full h-10 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest bg-white shadow-sm">
                                            <PlusCircle className="w-3.5 h-3.5 mr-2" /> Copy Portal Link
                                        </Button>
                                        <div className="p-3 bg-white/50 rounded-xl border-2 border-dashed border-primary/10 flex items-start gap-2">
                                            <Info className="w-3.5 h-3.5 text-primary opacity-40 mt-0.5" />
                                            <p className="text-[8px] font-bold text-slate-500 leading-tight uppercase">The link has been queued for dispatch via email/SMS. Use this manual copy for priority communication.</p>
                                        </div>
                                    </div>
                                </Card>
                            </div>
                            
                            <Button className="w-full h-16 text-lg font-black uppercase tracking-widest rounded-3xl shadow-3xl shadow-primary/20 transition-all active:scale-95" onClick={() => onOpenChange(false)}>Return to Agenda</Button>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </ScrollArea>
        
        {step !== 'success' && (
            <SheetFooter className={cn("p-4 sm:p-8 border-t bg-background/80 backdrop-blur-xl flex-shrink-0 z-20 shadow-2xl")}>
                <div className="flex w-full gap-4">
                    {currentStepIndex > 0 && (
                        <Button variant="ghost" onClick={handlePrevStep} className="flex-1 h-12 md:h-20 rounded-3xl font-black uppercase tracking-tighter text-[10px] md:text-2xl text-slate-400">
                            Back
                        </Button>
                    )}
                    <Button 
                        onClick={handleNext} 
                        disabled={isSubmitting || (step === 'details' && (!watchClientId || !watchServiceId))}
                        className={cn(
                            "h-12 md:h-20 font-black uppercase tracking-widest text-[10px] md:text-2xl rounded-[2rem] shadow-2xl shadow-primary/30 group transition-all",
                            currentStepIndex === 0 ? "w-full" : "flex-[2.5]"
                        )}
                    >
                        {isSubmitting ? (
                            <Loader className="animate-spin h-8 w-8" />
                        ) : (
                            <>
                                {step === 'details' ? 'Provider Routing' : 
                                 step === 'assignment' ? 'Select Window' : 
                                 step === 'timing' && depositDetails ? 'Deposit Settlement' : 
                                 'Finalize Booking'}
                                <ArrowRight className="ml-3 w-4 h-4 md:w-8 md:h-8 transition-transform group-hover:translate-x-1" />
                            </>
                        )}
                    </Button>
                </div>
            </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
};
