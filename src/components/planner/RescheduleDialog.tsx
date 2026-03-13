
'use client';

import React, { useState, useMemo } from 'react';
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
import { CalendarIcon, ChevronLeft, ChevronRight, Clock, AlertTriangle, ArrowRight, Sparkles, User, CalendarDays } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type Client, type Service, type Appointment, type Staff } from '@/lib/data';
import { format, setHours, setMinutes, startOfDay, areIntervalsOverlapping, addMinutes, startOfWeek, addDays, subWeeks, addWeeks, eachDayOfInterval, isSameDay, isBefore, isToday, parseISO, differenceInHours } from 'date-fns';
import { Card, CardContent } from '../ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { useInventory } from '@/context/InventoryContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Label } from '../ui/label';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { useTenant } from '@/context/TenantContext';
import { ScrollArea } from '../ui/scroll-area';
import { Separator } from '../ui/separator';

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

const RescheduleAppointmentForm = ({ 
    appointment,
    client, 
    service,
    appointments,
    services,
    onConfirm
}: { 
    appointment: Appointment;
    client: Client;
    service: Service;
    appointments: Appointment[];
    services: Service[];
    onConfirm: (apt: Appointment) => void;
}) => {
    const { scheduleProfiles, staff } = useInventory();
    const { selectedTenant: tenant } = useTenant();
    const publicScheduleProfile = useMemo(() => scheduleProfiles?.find((p: any) => p.isActive), [scheduleProfiles]);

    const [rescheduleDate, setRescheduleDate] = useState(safeDate(appointment.startTime));
    const [rescheduleTime, setRescheduleTime] = useState<string>(format(safeDate(appointment.startTime), 'HH:mm'));

    const assignedStaff = useMemo(() => staff?.find(s => s.id === appointment.staffId), [staff, appointment.staffId]);

    const isWithinCancellationWindow = useMemo(() => {
        if (!appointment || !tenant?.cancellationWindowHours) return false;
        const startTime = safeDate(appointment.startTime);
        const hoursUntil = differenceInHours(startTime, new Date());
        return hoursUntil < tenant.cancellationWindowHours;
    }, [appointment, tenant]);

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
        
        if (!workingHours || !workingHours.enabled) return [];

        const openTime = timeStringToDate(workingHours.start, rescheduleDate);
        const closeTime = timeStringToDate(workingHours.end, rescheduleDate);
        
        const busyIntervals: { start: Date, end: Date }[] = [];
        appointments.filter(apt => apt.id !== appointment.id && isSameDay(safeDate(apt.startTime), rescheduleDate) && apt.staffId === appointment.staffId).forEach(apt => {
            const svc = services.find(s => s.id === apt.serviceId);
            busyIntervals.push({ start: addMinutes(safeDate(apt.startTime), -(svc?.padBefore || 0)), end: addMinutes(safeDate(apt.endTime), (svc?.padAfter || 0)) });
        });

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
    }, [rescheduleDate, service, appointments, appointment, services, publicScheduleProfile, assignedStaff, staff]);

    const handleSubmit = () => {
        if (!rescheduleTime) return;
        const [hours, minutes] = rescheduleTime.split(':').map(Number);
        const startDateTime = setMinutes(setHours(startOfDay(rescheduleDate), hours), minutes);
        const endDateTime = addMinutes(startDateTime, service.duration);
        onConfirm({ ...appointment, startTime: startDateTime.toISOString(), endTime: endDateTime.toISOString() });
    }
    
    return (
        <div className="space-y-8">
            <Card className="border-4 border-primary/10 bg-primary/[0.02] rounded-[2rem] shadow-xl overflow-hidden">
                <CardContent className="p-6 flex items-center gap-6 text-left">
                    <Avatar className="w-16 h-16 border-4 border-background shadow-xl rounded-2xl">
                        <AvatarImage src={client.avatarUrl} className="object-cover" />
                        <AvatarFallback className="font-black bg-primary/10 text-primary">{(client.name || 'G').substring(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                        <p className="font-black text-xl uppercase tracking-tighter text-slate-900 leading-none mb-1">{client.name}</p>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{service.name}</p>
                    </div>
                </CardContent>
            </Card>

            {isWithinCancellationWindow && (
                <Alert variant="destructive" className="border-4 border-destructive bg-destructive/5 rounded-[2rem] p-6 shadow-2xl">
                    <AlertTriangle className="h-6 w-6 text-destructive" />
                    <AlertTitle className="text-sm font-black uppercase tracking-tight mb-2">Policy Restriction</AlertTitle>
                    <AlertDescription className="text-xs font-bold leading-relaxed opacity-80 uppercase">
                        This session is within the <strong>{tenant?.cancellationWindowHours}h window</strong>. Consider applying a late-move fee.
                    </AlertDescription>
                </Alert>
            )}

            <div className="space-y-4">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1 flex items-center gap-2"><CalendarDays className="w-3.5 h-3.5 opacity-40" /> Schedule Refinement</Label>
                <div className="rounded-[2.5rem] border-2 bg-muted/10 p-6 space-y-8 shadow-inner">
                    <div className="flex justify-between items-center px-2">
                        <Button variant="outline" size="icon" onClick={handlePreviousWeek} type="button" className="h-10 w-10 rounded-full bg-background shadow-md border-none"><ChevronLeft className="w-5 h-5" /></Button>
                        <span className="font-black uppercase tracking-widest text-sm">{format(rescheduleDate, 'MMMM yyyy')}</span>
                        <Button variant="outline" size="icon" onClick={handleNextWeek} type="button" className="h-10 w-10 rounded-full bg-background shadow-md border-none"><ChevronRight className="w-5 h-5" /></Button>
                    </div>
                    <div className="grid grid-cols-7 gap-2">
                        {weekDays.map(day => (
                            <button key={day.toISOString()} onClick={() => handleDateSelect(day)} type="button" className={cn("flex flex-col items-center justify-center p-3 rounded-2xl border-2 transition-all aspect-square", isSameDay(day, rescheduleDate) ? "bg-primary text-primary-foreground border-primary shadow-2xl scale-110" : "bg-background border-transparent hover:border-primary/30", isBefore(day, startOfDay(new Date())) && !isToday(day) && "opacity-20 cursor-not-allowed")}>
                                <span className="text-[10px] uppercase font-black opacity-60 mb-1">{format(day, 'EEE')}</span>
                                <span className="font-black text-xl tracking-tighter">{format(day, 'd')}</span>
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
            <Button id="submit-reschedule" className="hidden" onClick={handleSubmit}>Submit</Button>
        </div>
    );
};

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val === 'string') return parseISO(val);
    if (typeof val?.toDate === 'function') return val.toDate();
    return new Date(val);
};

export const RescheduleDialog = ({ open, onOpenChange, appointment, clients, services, appointments, onConfirm }: { open: boolean, onOpenChange: (open: boolean) => void, appointment: Appointment, clients: Client[], services: Service[], appointments: Appointment[], onConfirm: (apt: Appointment) => void }) => {
  const isMobile = useIsMobile();
  const client = clients.find(c => c.id === appointment.clientId);
  const service = services.find(s => s.id === appointment.serviceId);

  if (!client || !service) return null;

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
                <RescheduleAppointmentForm appointment={appointment} client={client} service={service} appointments={appointments} services={services} onConfirm={onConfirm} />
            </div>
        </ScrollArea>
        <SheetFooter className="p-8 pt-4 border-t bg-background flex-shrink-0 shadow-2xl">
            <div className="grid grid-cols-2 gap-3 w-full">
                <Button variant="ghost" onClick={() => onOpenChange(false)} className="h-12 font-black uppercase tracking-tighter text-[10px] text-slate-400">Cancel</Button>
                <Button onClick={() => document.getElementById('submit-reschedule')?.click()} className="h-12 rounded-[2rem] font-black uppercase tracking-widest text-[10px] shadow-2xl shadow-primary/30 active:scale-95 transition-all group">Confirm Shift <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1"/></Button>
            </div>
        </SheetFooter>
      </ContentComponent>
    </DialogContainer>
  );
};
