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
import { Button } from '@/components/ui/button';
import { 
    CalendarIcon, 
    ChevronLeft, 
    ChevronRight, 
    Clock, 
    AlertTriangle, 
    ArrowRight, 
    Sparkles, 
    User, 
    CalendarDays, 
    DollarSign, 
    CreditCard, 
    Landmark, 
    ShieldAlert,
    Info,
    Undo2,
    Lock,
    ShieldCheck,
    Loader,
    CreditCard as CardIcon,
    Zap,
    Unlock
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { type Client, type Service, type Appointment, type Staff } from '@/lib/data';
import { format, setHours, setMinutes, startOfDay, areIntervalsOverlapping, addMinutes, startOfWeek, addDays, subWeeks, addWeeks, eachDayOfInterval, isSameDay, isBefore, isToday, parseISO, differenceInHours, endOfDay } from 'date-fns';
import { Card, CardContent } from '../ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { useInventory } from '@/context/InventoryContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useTenant } from '@/context/TenantContext';
import { ScrollArea } from '../ui/scroll-area';
import { Separator } from '../ui/separator';
import { Input } from '../ui/input';
import { motion, AnimatePresence } from 'framer-motion';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';

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
    return new Date(val);
};

const RescheduleAppointmentForm = ({ 
    appointment,
    client, 
    service,
    appointments,
    services,
    onConfirm,
    isSubmitting
}: { 
    appointment: Appointment;
    client: Client;
    service: Service;
    appointments: Appointment[];
    services: Service[];
    onConfirm: (data: any) => void;
    isSubmitting: boolean;
}) => {
    const { scheduleProfiles, staff, events: allEvents } = useInventory();
    const { selectedTenant: tenant } = useTenant();
    const publicScheduleProfile = useMemo(() => scheduleProfiles?.find((p: any) => p.isActive), [scheduleProfiles]);

    const [rescheduleDate, setRescheduleDate] = useState(safeDate(appointment.startTime));
    const [rescheduleTime, setRescheduleTime] = useState<string>(format(safeDate(appointment.startTime), 'HH:mm'));
    
    // Fee State
    const [applyFee, setApplyFee] = useState(false);
    const [paymentMethod, setPaymentMethod] = useState<'card_on_file' | 'charge_new_card' | 'add_to_session'>('add_to_session');
    const [overrideBusinessHours, setOverrideBusinessHours] = useState(false);

    const assignedStaff = useMemo(() => staff?.find(s => s.id === appointment.staffId), [staff, appointment.staffId]);
    const hasCardOnFile = !!client?.cardOnFile?.token;

    const isWithinCancellationWindow = useMemo(() => {
        if (!appointment || !tenant?.cancellationWindowHours) return false;
        const startTime = safeDate(appointment.startTime);
        const hoursUntil = differenceInHours(startTime, new Date());
        return hoursUntil < tenant.cancellationWindowHours;
    }, [appointment, tenant]);

    const recoveryFee = useMemo(() => {
        if (!tenant?.tmhr || !service) return 0;
        const duration = service.duration || 60;
        return Number(((duration / 60) * tenant.tmhr).toFixed(2));
    }, [tenant?.tmhr, service]);

    const weekStart = useMemo(() => startOfWeek(rescheduleDate), [rescheduleDate]);
    const weekDays = useMemo(() => eachDayOfInterval({ start: weekStart, end: addDays(weekStart, 6) }), [weekStart]);

    const handlePreviousWeek = () => setRescheduleDate(prev => subWeeks(prev, 1));
    const handleNextWeek = () => setRescheduleDate(prev => addWeeks(prev, 1));
    const handleDateSelect = (day: Date) => setRescheduleDate(day);

    const timeSlots = useMemo(() => {
        if (!service || !rescheduleDate || !publicScheduleProfile || !staff || !services) return [];
        const bookingInterval = publicScheduleProfile.bookingSlotInterval || 15;
        const dayName = format(rescheduleDate, 'eeee').toLowerCase();
        
        let workingHours;
        const staffDaySchedule = assignedStaff?.availability?.week?.[dayName as keyof typeof assignedStaff.availability.week];
        if (staffDaySchedule?.enabled) workingHours = staffDaySchedule;
        else workingHours = publicScheduleProfile?.week?.[dayName];
        
        if (!overrideBusinessHours && (!workingHours || !workingHours.enabled)) return [];

        const openTime = overrideBusinessHours ? startOfDay(rescheduleDate) : timeStringToDate(workingHours?.start || '09:00 AM', rescheduleDate);
        const closeTime = overrideBusinessHours ? endOfDay(rescheduleDate) : timeStringToDate(workingHours?.end || '05:00 PM', rescheduleDate);
        
        const busyIntervals: { start: Date, end: Date }[] = [];
        appointments.filter(apt => apt.id !== appointment.id && isSameDay(safeDate(apt.startTime), rescheduleDate) && apt.staffId === appointment.staffId).forEach(apt => {
            const svc = services.find(s => s.id === apt.serviceId);
            busyIntervals.push({ start: addMinutes(safeDate(apt.startTime), -(svc?.padBefore || 0)), end: addMinutes(safeDate(apt.endTime), (svc?.padAfter || 0)) });
        });

        (allEvents || []).filter(evt => {
            if (!isSameDay(safeDate(evt.startTime), rescheduleDate) || evt.type !== 'blocked') return false;
            return !evt.staffIds || evt.staffIds.includes('all') || (appointment.staffId && evt.staffIds.includes(appointment.staffId));
        }).forEach(evt => { busyIntervals.push({ start: safeDate(evt.startTime), end: safeDate(evt.endTime) }); });

        const options: string[] = [];
        let currentTime = openTime;
        while (currentTime < closeTime) {
            const potentialEnd = addMinutes(currentTime, service.duration + (service.padBefore || 0) + (service.padAfter || 0));
            if (potentialEnd > closeTime) break;
            const isOverlapping = busyIntervals.some((interval) => areIntervalsOverlapping({ start: currentTime, end: potentialEnd }, interval, { inclusive: false }));
            if (!isOverlapping) options.push(format(currentTime, 'HH:mm'));
            currentTime = addMinutes(currentTime, bookingInterval);
        }
        
        const originalTimeFormatted = format(safeDate(appointment.startTime), 'HH:mm');
        if (isSameDay(rescheduleDate, safeDate(appointment.startTime)) && !options.includes(originalTimeFormatted)) {
            options.push(originalTimeFormatted);
            options.sort();
        }
        return options;
    }, [rescheduleDate, service, appointments, appointment, services, publicScheduleProfile, assignedStaff, staff, allEvents, overrideBusinessHours]);

    const handleSubmit = () => {
        if (!rescheduleTime) return;
        const [hours, minutes] = rescheduleTime.split(':').map(Number);
        const startDateTime = setMinutes(setHours(startOfDay(rescheduleDate), hours), minutes);
        const endDateTime = addMinutes(startDateTime, service.duration);
        
        onConfirm({ 
            ...appointment, 
            startTime: startDateTime.toISOString(), 
            endTime: endDateTime.toISOString(),
            applyFee,
            feeAmount: applyFee ? recoveryFee : 0,
            paymentMethod
        });
    }

    return (
        <div className="space-y-8">
            <Card className="border-4 border-primary/10 bg-primary/[0.02] rounded-[2rem] shadow-xl overflow-hidden">
                <CardContent className="p-6 flex items-center gap-6 text-left">
                    <Avatar className="w-16 h-16 border-4 border-background shadow-xl rounded-2xl shrink-0">
                        <AvatarImage src={client.avatarUrl} className="object-cover" />
                        <AvatarFallback className="font-black bg-primary/10 text-primary">{(client.name || 'G').substring(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                        <p className="font-black text-xl uppercase tracking-tighter text-slate-900 leading-none mb-1 truncate">{client.name}</p>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{service.name}</p>
                    </div>
                </CardContent>
            </Card>

            <AnimatePresence>
                {isWithinCancellationWindow && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                        <div className="space-y-6">
                            <Alert variant="destructive" className="border-4 border-destructive bg-destructive/5 rounded-[2.5rem] p-6 shadow-2xl">
                                <AlertTriangle className="h-6 w-6 text-destructive" />
                                <AlertTitle className="text-sm font-black uppercase tracking-tight mb-2">Policy Restriction</AlertTitle>
                                <AlertDescription className="text-xs font-bold leading-relaxed opacity-80 uppercase text-left">
                                    This session is within the <strong>{tenant?.cancellationWindowHours}h window</strong>. Consider applying a late-move fee.
                                </AlertDescription>
                            </Alert>

                            <div className="p-6 rounded-[2.5rem] border-4 border-primary/10 bg-primary/[0.02] shadow-inner space-y-6">
                                <div className="flex items-center justify-between">
                                    <div className="space-y-1 text-left">
                                        <Label className="text-base font-black uppercase tracking-tight flex items-center gap-2">
                                            <DollarSign className="w-4 h-4 text-primary" />
                                            Protocol Adjustment Fee
                                        </Label>
                                        <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">Overhead recovery for restricted window move</p>
                                    </div>
                                    <div className="flex flex-col items-end gap-2">
                                        <span className={cn("text-2xl font-black font-mono tracking-tighter", applyFee ? "text-primary" : "text-muted-foreground opacity-40")}>
                                            ${recoveryFee.toFixed(2)}
                                        </span>
                                        <Switch checked={applyFee} onCheckedChange={setApplyFee} />
                                    </div>
                                </div>

                                <AnimatePresence>
                                    {applyFee && (
                                        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="space-y-4 pt-4 border-t-2 border-dashed border-primary/10">
                                            <Label className="text-[10px] font-black uppercase tracking-widest text-primary ml-1">Distribution Method</Label>
                                            <RadioGroup value={paymentMethod} onValueChange={(v: any) => setPaymentMethod(v)} className="grid grid-cols-3 gap-2">
                                                <label htmlFor="resched-pay-session" className="cursor-pointer flex-1 h-full">
                                                    <RadioGroupItem value="add_to_session" id="resched-pay-session" className="peer sr-only" />
                                                    <div className={cn("flex flex-col items-center justify-center p-3 border-2 rounded-2xl transition-all text-center h-full", paymentMethod === 'add_to_session' ? "border-primary bg-primary/5 shadow-md" : "border-border bg-white")}>
                                                        <Zap className={cn("w-5 h-5 mb-1.5 transition-colors", paymentMethod === 'add_to_session' ? "text-primary" : "text-muted-foreground opacity-40")} />
                                                        <span className="text-[8px] font-black uppercase tracking-widest text-slate-900 leading-tight">To Session</span>
                                                    </div>
                                                </label>
                                                <label htmlFor="resched-pay-card" className={cn("cursor-pointer flex-1 h-full", !hasCardOnFile && "opacity-40 grayscale")}>
                                                    <RadioGroupItem value="card_on_file" id="resched-pay-card" className="peer sr-only" disabled={!hasCardOnFile} />
                                                    <div className={cn("flex flex-col items-center justify-center p-3 border-2 rounded-2xl transition-all text-center h-full", paymentMethod === 'card_on_file' ? "border-primary bg-primary/5 shadow-md" : "border-border bg-white")}>
                                                        {hasCardOnFile ? <ShieldCheck className="w-5 h-5 mb-1.5 text-primary" /> : <Lock className="w-5 h-5 mb-1.5 text-slate-400" />}
                                                        <span className="text-[8px] font-black uppercase tracking-widest text-slate-900 leading-tight">Vault</span>
                                                    </div>
                                                </label>
                                                <label htmlFor="resched-pay-new" className="cursor-pointer flex-1 h-full">
                                                    <RadioGroupItem value="charge_new_card" id="resched-pay-new" className="peer sr-only" />
                                                    <div className={cn("flex flex-col items-center justify-center p-3 border-2 rounded-2xl transition-all text-center h-full", paymentMethod === 'charge_new_card' ? "border-primary bg-primary/5 shadow-md" : "border-border bg-white")}>
                                                        <CardIcon className={cn("w-5 h-5 mb-1.5 transition-colors", paymentMethod === 'charge_new_card' ? "text-primary" : "text-muted-foreground opacity-40")} />
                                                        <span className="text-[8px] font-black uppercase tracking-widest text-slate-900 leading-tight">New Card</span>
                                                    </div>
                                                </label>
                                            </RadioGroup>

                                            {paymentMethod === 'charge_new_card' && (
                                                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="p-5 rounded-2xl border-4 border-primary/10 bg-white space-y-4 shadow-xl text-left">
                                                    <div className="flex items-center gap-2 mb-2">
                                                        <Lock className="w-3.5 h-3.5 text-primary opacity-40" />
                                                        <span className="text-[9px] font-black uppercase tracking-widest text-primary/60">Encrypted Terminal Flow</span>
                                                    </div>
                                                    <div className="space-y-3">
                                                        <div className="space-y-1 text-left">
                                                            <Label className="text-[8px] font-black uppercase text-muted-foreground ml-1">Card Protocol</Label>
                                                            <Input placeholder="•••• •••• •••• ••••" className="h-10 rounded-xl border-2 font-mono text-xs shadow-inner" />
                                                        </div>
                                                        <div className="grid grid-cols-2 gap-3">
                                                            <div className="space-y-1 text-left">
                                                                <Label className="text-[8px] font-black uppercase text-muted-foreground ml-1">Expiry</Label>
                                                                <Input placeholder="MM / YY" className="h-10 rounded-xl border-2 text-center text-xs" />
                                                            </div>
                                                            <div className="space-y-1 text-left">
                                                                <Label className="text-[8px] font-black uppercase text-muted-foreground ml-1">CVC</Label>
                                                                <Input placeholder="•••" className="h-10 rounded-xl border-2 text-center text-xs" />
                                                            </div>
                                                        </div>
                                                    </div>
                                                </motion.div>
                                            )}
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1 flex items-center gap-2">
                        <CalendarDays className="w-3.5 h-3.5 opacity-40" /> 
                        Schedule Refinement
                    </Label>
                    <div className="flex items-center gap-3 p-2 bg-muted/20 rounded-xl border-2 border-transparent">
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div className="flex items-center gap-2">
                                        <Unlock className={cn("w-3.5 h-3.5 transition-colors", overrideBusinessHours ? "text-primary" : "text-muted-foreground opacity-40")} />
                                        <Switch 
                                            id="override-hours-resched" 
                                            checked={overrideBusinessHours} 
                                            onCheckedChange={setOverrideBusinessHours} 
                                        />
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent className="font-black uppercase text-[9px] tracking-widest border-2">Override Business Hours</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                </div>
                <div className="rounded-[2.5rem] border-2 bg-muted/10 p-6 space-y-8 shadow-inner">
                    <div className="flex justify-between items-center px-2">
                        <Button variant="outline" size="icon" onClick={handlePreviousWeek} type="button" className="h-10 w-10 rounded-full bg-background shadow-md border-none"><ChevronLeft className="w-5 h-5" /></Button>
                        <span className="font-black uppercase tracking-widest text-sm">{format(rescheduleDate, 'MMMM yyyy')}</span>
                        <Button variant="outline" size="icon" onClick={handleNextWeek} type="button" className="h-10 w-10 rounded-full bg-background shadow-md border-none"><ChevronRight className="w-5 h-5" /></Button>
                    </div>
                    <div className="grid grid-cols-7 gap-2">
                        {weekDays.map(day => (
                            <button key={day.toISOString()} onClick={() => handleDateSelect(day)} type="button" className={cn("flex flex-col items-center justify-center p-3 rounded-2xl border-2 transition-all aspect-square", isSameDay(day, rescheduleDate) ? "bg-primary text-primary-foreground border-primary shadow-2xl scale-110" : "bg-background border-transparent hover:border-primary/30", isBefore(day, startOfDay(new Date())) && !isToday(day) && !overrideBusinessHours && "opacity-20 cursor-not-allowed")}>
                                <span className="text-[8px] sm:text-[10px] uppercase font-black opacity-60 mb-1">{format(day, 'E')}</span>
                                <span className="font-black text-sm md:text-xl tracking-tighter">{format(day, 'd')}</span>
                            </button>
                        ))}
                    </div>
                    <div className="grid grid-cols-3 gap-3 pt-8 border-t-2 border-dashed border-white/50">
                        {timeSlots.map(slot => (
                            <Button key={slot} type="button" variant={rescheduleTime === slot ? 'default' : 'outline'} className={cn("h-14 font-black uppercase text-xs tracking-widest rounded-2xl border-2 transition-all", rescheduleTime === slot ? "shadow-2xl shadow-primary/20 scale-105" : "bg-background")} onClick={() => setRescheduleTime(slot)}>
                                {format(timeStringToDate(slot, new Date()), 'h:mm a')}
                            </Button>
                        ))}
                        {timeSlots.length === 0 && <div className="col-span-full text-center py-12 border-2 border-dashed rounded-[2rem] opacity-30 font-black uppercase text-[10px]">No Availability</div>}
                    </div>
                </div>
            </div>
            
            <Button id="submit-reschedule-btn" className="hidden" onClick={handleSubmit}>Submit</Button>
        </div>
    );
};

export const RescheduleDialog = ({ 
    open, 
    onOpenChange, 
    appointment, 
    clients, 
    services, 
    appointments, 
    onConfirm 
}: { 
    open: boolean, 
    onOpenChange: (open: boolean) => void, 
    appointment: Appointment, 
    clients: Client[], 
    services: Service[], 
    appointments: Appointment[], 
    onConfirm: (data: any) => Promise<void> 
}) => {
  const isMobile = useIsMobile();
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const client = clients.find(c => c.id === appointment.clientId);
  const service = services.find(s => s.id === appointment.serviceId);

  if (!client || !service) return null;

  const handleConfirmedAction = async (data: any) => {
      setIsSubmitting(true);
      await onConfirm(data);
      setIsSubmitting(false);
      onOpenChange(false);
  }

  const DialogContainer = isMobile ? Sheet : Dialog;
  const ContentComponent = isMobile ? SheetContent : DialogContent;

  return (
    <DialogContainer open={open} onOpenChange={onOpenChange}>
      <ContentComponent side={isMobile ? "bottom" : "right"} className={cn("p-0 border-none bg-background flex flex-col shadow-3xl overflow-hidden", isMobile ? "h-[92dvh] rounded-t-[3rem]" : "sm:max-w-xl max-h-[90dvh]")}>
        <SheetHeader className={cn("p-8 pb-6 border-b bg-muted/5 flex-shrink-0 text-left", isMobile && "p-6")}>
            <div className="flex items-center gap-3 mb-2">
                <Sparkles className="w-5 h-5 text-primary" />
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Logistics Suite</span>
            </div>
            <SheetTitle className="text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">Reschedule Protocol</SheetTitle>
            <SheetDescription className="text-xs font-bold uppercase tracking-widest opacity-60 mt-1">Shift session timing in the studio manifest.</SheetDescription>
        </SheetHeader>
        <ScrollArea className="flex-1">
            <div className={cn("p-8", isMobile && "p-6")}>
                <RescheduleAppointmentForm 
                    appointment={appointment} 
                    client={client} 
                    service={service} 
                    appointments={appointments} 
                    services={services} 
                    onConfirm={handleConfirmedAction}
                    isSubmitting={isSubmitting}
                />
            </div>
        </ScrollArea>
        <SheetFooter className="p-8 pt-4 border-t bg-background flex-shrink-0 shadow-2xl">
            <div className="grid grid-cols-2 gap-3 w-full">
                <Button variant="outline" onClick={() => onOpenChange(false)} className="h-12 rounded-xl font-black uppercase text-[10px] tracking-widest border-2 bg-white">Cancel</Button>
                <Button 
                    onClick={() => document.getElementById('submit-reschedule-btn')?.click()} 
                    disabled={isSubmitting}
                    className="h-12 rounded-[2rem] font-black uppercase tracking-widest text-[10px] shadow-2xl shadow-primary/30 active:scale-95 transition-all group"
                >
                    {isSubmitting ? <Loader className="animate-spin h-4 w-4" /> : (
                        <>Confirm Shift <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1"/></>
                    )}
                </Button>
            </div>
        </SheetFooter>
      </ContentComponent>
    </DialogContainer>
  );
};
