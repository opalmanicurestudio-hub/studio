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
    CalendarDays, 
    DollarSign, 
    Undo2, 
    Landmark, 
    ShieldCheck, 
    Loader,
    CheckCircle2,
    Activity,
    Scale,
    Info,
    PackageOpen
} from 'lucide-react';
import { cn, safeNumber } from '@/lib/utils';
import { type Client, type Service, type Appointment, type Staff, type PricingTier } from '@/lib/data';
import { 
    format, 
    setHours, 
    setMinutes, 
    startOfDay, 
    areIntervalsOverlapping, 
    addMinutes, 
    addDays, 
    subWeeks, 
    addWeeks, 
    eachDayOfInterval, 
    isSameDay, 
    isBefore, 
    isToday, 
    parseISO, 
    differenceInHours, 
    endOfDay,
    startOfWeek
} from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { useInventory } from '@/context/InventoryContext';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { motion, AnimatePresence } from 'framer-motion';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { useToast } from '@/hooks/use-toast';

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

export const GuestRescheduleDialog = ({
    open,
    onOpenChange,
    appointment,
    client,
    service,
    appointments,
    services,
    tenant,
    staff,
    scheduleProfiles,
    inventory,
    onConfirm
}: {
    open: boolean,
    onOpenChange: (open: boolean) => void,
    appointment: Appointment,
    client: Client,
    service: Service,
    appointments: Appointment[],
    services: Service[],
    tenant: any,
    staff: Staff[],
    scheduleProfiles: any[],
    inventory: any[],
    onConfirm: (data: any) => Promise<void>
}) => {
    const isMobile = useIsMobile();
    const { toast } = useToast();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [rescheduleDate, setRescheduleDate] = useState(safeDate(appointment.startTime));
    const [rescheduleTime, setRescheduleTime] = useState<string>(format(safeDate(appointment.startTime), 'HH:mm'));
    const [overrideBusinessHours, setOverrideBusinessHours] = useState(false);

    const publicScheduleProfile = useMemo(() => scheduleProfiles?.find((p: any) => p.isActive), [scheduleProfiles]);
    const assignedStaff = useMemo(() => staff?.find(s => s.id === appointment.staffId), [staff, appointment.staffId]);

    // SCHEDULING NAVIGATION
    const weekStart = useMemo(() => startOfWeek(rescheduleDate, { weekStartsOn: 0 }), [rescheduleDate]);
    const weekDays = useMemo(() => eachDayOfInterval({ start: weekStart, end: addDays(weekStart, 6) }), [weekStart]);

    const handlePreviousWeek = () => setRescheduleDate(prev => subWeeks(prev, 1));
    const handleNextWeek = () => setRescheduleDate(prev => addWeeks(prev, 1));
    const handleDateSelect = (day: Date) => setRescheduleDate(day);

    // POLICY LOGIC
    const isWithinCancellationWindow = useMemo(() => {
        if (!appointment || !tenant?.cancellationWindowHours) return false;
        const startTime = safeDate(appointment.startTime);
        const hoursUntil = differenceInHours(startTime, new Date());
        const requiredWindow = service.cancellationWindowHours || tenant.cancellationWindowHours || 24;
        return hoursUntil < requiredWindow;
    }, [appointment, tenant, service]);

    const recoveryFee = useMemo(() => {
        if (!isWithinCancellationWindow) return 0;
        if (!tenant?.tmhr || !service) return 0;
        
        const mode = service.cancellationFeeMode || tenant.defaultCancellationMode || 'matrix';
        
        if (mode === 'percentage') {
            return service.price * (safeNumber(tenant.cancellationFeePercent || 50) / 100);
        } else if (mode === 'flat') {
            return service.customCancellationFee || tenant.cancellationFee || 0;
        } else {
            // Matrix Calculation (Time + Materials)
            const totalDuration = (service.duration || 60) + (service.padBefore || 0) + (service.padAfter || 0);
            const overhead = (totalDuration / 60) * tenant.tmhr;
            const materialCost = (service.products || []).reduce((acc, p) => {
                const product = inventory.find(i => i.id === p.id);
                let cpu = 0;
                if (product) {
                    if (product.costingMethod === 'size' && product.size) cpu = (product.costPerUnit || 0) / product.size;
                    else if (product.costingMethod === 'uses' && product.estimatedUses) cpu = (product.costPerUnit || 0) / product.estimatedUses;
                    else cpu = product.costPerUnit || 0;
                }
                return acc + (cpu * (p.quantityUsed || 1));
            }, 0);
            return Number((overhead + materialCost).toFixed(2));
        }
    }, [isWithinCancellationWindow, tenant, service, inventory]);

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
        appointments.filter(apt => apt.id !== appointment.id && isSameDay(safeDate(apt.startTime), rescheduleDate) && apt.staffId === appointment.staffId && apt.status !== 'cancelled').forEach(apt => {
            const svc = services.find(s => s.id === apt.serviceId);
            busyIntervals.push({ start: addMinutes(safeDate(apt.startTime), -(svc?.padBefore || 0)), end: addMinutes(safeDate(apt.endTime), (svc?.padAfter || 0)) });
        });

        const options: string[] = [];
        let currentTime = openTime;
        const now = new Date();
        if (isToday(rescheduleDate) && now > openTime) {
            const minSinceStart = (now.getHours() * 60) + now.getMinutes();
            const busStartMin = (openTime.getHours() * 60) + openTime.getMinutes();
            const skip = Math.ceil((minSinceStart - busStartMin) / bookingInterval);
            if (skip > 0) currentTime = addMinutes(openTime, skip * bookingInterval);
        }

        while (currentTime < closeTime) {
            const potentialEnd = addMinutes(currentTime, service.duration + (service.padBefore || 0) + (service.padAfter || 0));
            if (potentialEnd > closeTime) break;
            const isOverlapping = busyIntervals.some((interval) => areIntervalsOverlapping({ start: currentTime, end: potentialEnd }, interval, { inclusive: false }));
            if (!isOverlapping) options.push(format(currentTime, 'HH:mm'));
            currentTime = addMinutes(currentTime, bookingInterval);
        }
        return options;
    }, [rescheduleDate, service, appointments, appointment, services, publicScheduleProfile, assignedStaff, staff, overrideBusinessHours]);

    const handleAction = async () => {
        if (!rescheduleTime) return;
        setIsSubmitting(true);
        const [hours, minutes] = rescheduleTime.split(':').map(Number);
        const startDateTime = setMinutes(setHours(startOfDay(rescheduleDate), hours), minutes);
        const endDateTime = addMinutes(startDateTime, service.duration);
        
        await onConfirm({ 
            ...appointment, 
            startTime: startDateTime.toISOString(), 
            endTime: endDateTime.toISOString(),
            applyFee: recoveryFee > 0,
            feeAmount: recoveryFee,
            paymentMethod: 'add_to_balance'
        });
        setIsSubmitting(false);
        onOpenChange(false);
    };

    const DialogContainer = isMobile ? Sheet : Dialog;
    const ContentComponent = isMobile ? SheetContent : DialogContent;

    return (
        <DialogContainer open={open} onOpenChange={onOpenChange}>
            <ContentComponent side={isMobile ? "bottom" : "right"} className={cn("p-0 border-none bg-background flex flex-col shadow-3xl overflow-hidden", isMobile ? "h-[92dvh] rounded-t-[3rem]" : "sm:max-w-xl max-h-[90dvh]")}>
                <SheetHeader className={cn("p-8 pb-6 border-b bg-muted/5 flex-shrink-0 text-left", isMobile && "p-6 pb-4")}>
                    <div className="flex items-center gap-3 mb-2 text-left">
                        <Sparkles className="w-5 h-5 text-primary" />
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Logistics Update</span>
                    </div>
                    <SheetTitle className="text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none text-left">Update Session</SheetTitle>
                    <SheetDescription className="text-xs font-bold uppercase tracking-widest opacity-60 mt-1 text-left">Reschedule your appointment for: <strong>{service.name}</strong></SheetDescription>
                </SheetHeader>

                <ScrollArea className="flex-1">
                    <div className={cn("p-8 pt-4 space-y-10", isMobile && "p-6")}>
                        <AnimatePresence>
                            {isWithinCancellationWindow && (
                                <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
                                    <Alert variant="destructive" className="border-4 border-destructive/20 bg-destructive/[0.02] rounded-[2.5rem] p-6 shadow-2xl">
                                        <AlertTriangle className="h-6 w-6 text-destructive" />
                                        <AlertTitle className="text-sm font-black uppercase tracking-tight mb-2">Protocol Notice</AlertTitle>
                                        <AlertDescription className="text-xs font-bold leading-relaxed opacity-80 uppercase text-left">
                                            This session is within the <strong>{service.cancellationWindowHours || tenant?.cancellationWindowHours || 24}h</strong> notice window.
                                        </AlertDescription>
                                    </Alert>

                                    <div className="p-6 rounded-[2.5rem] border-4 border-primary/10 bg-primary/[0.02] shadow-inner space-y-4 text-center">
                                        <p className="text-[10px] font-black uppercase text-primary/60 tracking-widest leading-none">Operational Recovery Fee</p>
                                        <p className="text-5xl font-black text-primary tracking-tighter font-mono">${recoveryFee.toFixed(2)}</p>
                                        <div className="p-4 rounded-xl border-2 border-dashed bg-white/50 flex items-start gap-3 text-left">
                                            <Info className="w-4 h-4 text-primary shrink-0 mt-0.5 opacity-40" />
                                            <p className="text-[10px] font-bold text-slate-600 leading-relaxed uppercase tracking-tight">
                                                This fee compensates the studio for the reserved time and materials. By proceeding, you agree to have this amount added to your account ledger.
                                            </p>
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        <div className="space-y-4 text-left">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">New Timing Selection</Label>
                            <div className="rounded-[2.5rem] border-2 bg-muted/10 p-6 space-y-8 shadow-inner text-center">
                                <div className="flex justify-between items-center px-2">
                                    <Button variant="outline" size="icon" onClick={handlePreviousWeek} type="button" className="h-10 w-10 rounded-full bg-background shadow-md border-none"><ChevronLeft className="w-5 h-5" /></Button>
                                    <span className="font-black uppercase tracking-widest text-sm">{format(rescheduleDate, 'MMMM yyyy')}</span>
                                    <Button variant="outline" size="icon" onClick={handleNextWeek} type="button" className="h-10 w-10 rounded-full bg-background shadow-md border-none"><ChevronRight className="w-5 h-5" /></Button>
                                </div>
                                <div className="grid grid-cols-7 gap-2">
                                    {weekDays.map(day => (
                                        <button
                                            key={day.toISOString()}
                                            onClick={() => handleDateSelect(day)}
                                            type="button"
                                            className={cn(
                                                "flex flex-col items-center justify-center p-3 rounded-2xl border-2 transition-all aspect-square",
                                                isSameDay(day, rescheduleDate)
                                                    ? "bg-primary text-primary-foreground border-primary shadow-2xl scale-110"
                                                    : "bg-background border-transparent hover:border-primary/30",
                                                isBefore(day, startOfDay(new Date())) && !isToday(day) && "opacity-20 cursor-not-allowed"
                                            )}
                                            disabled={isBefore(day, startOfDay(new Date())) && !isToday(day)}
                                        >
                                            <span className="text-[8px] sm:text-[10px] uppercase font-black opacity-60 mb-1">{format(day, 'E')}</span>
                                            <span className="font-black text-sm md:text-xl tracking-tighter">{format(day, 'd')}</span>
                                        </button>
                                    ))}
                                </div>
                                <div className="grid grid-cols-3 gap-3 pt-8 border-t-2 border-dashed border-white/50">
                                    {timeSlots.map(slot => (
                                        <Button
                                            key={slot}
                                            type="button"
                                            variant={rescheduleTime === slot ? 'default' : 'outline'}
                                            className={cn(
                                                "h-14 font-black uppercase text-xs tracking-widest rounded-2xl border-2 transition-all",
                                                rescheduleTime === slot ? "shadow-2xl shadow-primary/20 scale-105" : "bg-background"
                                            )}
                                            onClick={() => setRescheduleTime(slot)}
                                        >
                                            {format(timeStringToDate(slot, new Date()), 'h:mm a')}
                                        </Button>
                                    ))}
                                    {timeSlots.length === 0 && <div className="col-span-full text-center py-12 border-2 border-dashed rounded-[2rem] opacity-30 font-black uppercase text-[10px]">No Availability</div>}
                                </div>
                            </div>
                        </div>
                    </div>
                </ScrollArea>

                <SheetFooter className="p-8 pt-4 border-t bg-background flex-shrink-0">
                    <div className="flex flex-col gap-3 w-full">
                        <Button
                            onClick={handleAction}
                            disabled={isSubmitting || !rescheduleTime}
                            className="w-full h-16 rounded-[2rem] font-black uppercase tracking-widest text-[11px] md:text-sm shadow-3xl shadow-primary/30 active:scale-95 transition-all group"
                        >
                            {isSubmitting ? <Loader className="animate-spin h-5 w-5" /> : (
                                <>
                                    {recoveryFee > 0 ? `Agree to Fee & Confirm Move` : 'Confirm New Timing'}
                                    <ArrowRight className="ml-2 w-5 h-5 transition-transform group-hover:translate-x-1" />
                                </>
                            )}
                        </Button>
                        <Button variant="ghost" onClick={() => onOpenChange(false)} className="w-full font-bold uppercase text-[10px] tracking-widest text-slate-400">Abort Changes</Button>
                    </div>
                </SheetFooter>
            </ContentComponent>
        </DialogContainer>
    );
};
