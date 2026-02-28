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
  DialogTrigger
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Button, buttonVariants } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarIcon, ChevronLeft, ChevronRight, Clock, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Client, Service, Appointment, Staff } from '@/lib/data';
import { format, setHours, setMinutes, startOfDay, areIntervalsOverlapping, addMinutes, startOfWeek, addDays, subWeeks, addWeeks, eachDayOfInterval, isSameDay, isBefore, isToday, parseISO, differenceInHours } from 'date-fns';
import { Card, CardContent } from '../ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { useInventory } from '@/context/InventoryContext';
import { Calendar } from '@/components/ui/calendar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Label } from '../ui/label';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { useTenant } from '@/context/TenantContext';

const timeStringToDate = (timeStr: string, date: Date): Date => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);

    if (!timeStr) {
      return d;
    }

    const [time, period] = timeStr.split(' ');
    let [hours, minutes] = time.split(':').map(Number);

    if (period === 'PM' && hours < 12) {
        hours += 12;
    }
    if (period === 'AM' && hours === 12) {
        hours = 0;
    }

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
    const publicScheduleProfile = useMemo(() => scheduleProfiles?.find(p => p.isActive), [scheduleProfiles]);

    const [rescheduleDate, setRescheduleDate] = useState(appointment.startTime);
    const [rescheduleTime, setRescheduleTime] = useState<string>(format(appointment.startTime, 'HH:mm'));

    const assignedStaff = useMemo(() => staff?.find(s => s.id === appointment.staffId), [staff, appointment.staffId]);

    const isWithinCancellationWindow = useMemo(() => {
        if (!appointment || !tenant?.cancellationWindowHours) return false;
        const startTime = appointment.startTime instanceof Date ? appointment.startTime : new Date(appointment.startTime);
        const hoursUntil = differenceInHours(startTime, new Date());
        return hoursUntil < tenant.cancellationWindowHours;
    }, [appointment, tenant]);

    const weekStart = useMemo(() => startOfWeek(rescheduleDate), [rescheduleDate]);
    const weekDays = useMemo(() => eachDayOfInterval({ start: weekStart, end: addDays(weekStart, 6) }), [weekStart]);

    const handlePreviousWeek = () => setRescheduleDate(prev => subWeeks(prev, 1));
    const handleNextWeek = () => setRescheduleDate(prev => addWeeks(prev, 1));
    const handleDateSelect = (day: Date) => setRescheduleDate(day);

     const isDayClosed = (day: Date) => {
        if (!publicScheduleProfile) return true;
        const dayName = format(day, 'eeee').toLowerCase();
        const staffDaySchedule = assignedStaff?.availability?.week?.[dayName as keyof typeof assignedStaff.availability.week];
        if (staffDaySchedule?.enabled) {
            return false;
        }
        if (staffDaySchedule && !staffDaySchedule.enabled) {
            return true;
        }
        const dayHours = publicScheduleProfile.week[dayName];
        return !dayHours || !dayHours.enabled;
    }

    const timeSlots = useMemo(() => {
        if (!service || !rescheduleDate || !publicScheduleProfile || !staff || !services) return [];

        const bookingInterval = publicScheduleProfile.bookingSlotInterval || 15;
        const dayName = format(rescheduleDate, 'eeee').toLowerCase();
        
        let workingHours: { enabled: boolean; start: string; end: string; } | undefined;

        const staffDaySchedule = assignedStaff?.availability?.week?.[dayName as keyof typeof assignedStaff.availability.week];

        if (staffDaySchedule?.enabled) {
            workingHours = staffDaySchedule;
        } else if (staffDaySchedule && !staffDaySchedule.enabled) {
            return []; // Staff is explicitly not working this day
        }
        else {
            workingHours = publicScheduleProfile?.week?.[dayName];
        }
        
        if (!workingHours || !workingHours.enabled) {
          return [];
        }

        const openTime = timeStringToDate(workingHours.start, rescheduleDate);
        const closeTime = timeStringToDate(workingHours.end, rescheduleDate);
        
        const existingAppointmentsOnDate = appointments.filter(
            apt => apt.id !== appointment.id && isSameDay(apt.startTime, rescheduleDate) && apt.staffId === appointment.staffId
        ).map(apt => {
            const serviceForApt = services.find(s => s.id === apt.serviceId);
            const padBefore = serviceForApt?.padBefore || 0;
            const padAfter = serviceForApt?.padAfter || 0;
            return {
                start: addMinutes(apt.startTime, -padBefore),
                end: addMinutes(apt.endTime, padAfter)
            }
        });

        const options: string[] = [];
        let currentTime = openTime;
        
        while (currentTime < closeTime) {
            const potentialStartTime = currentTime;
            const totalDuration = service.duration + (service.padBefore || 0) + (service.padAfter || 0);
            const potentialEndTime = addMinutes(potentialStartTime, totalDuration);

            if (potentialEndTime > closeTime) {
                break;
            }

            const isOverlapping = existingAppointmentsOnDate.some(apt =>
                areIntervalsOverlapping(
                    { start: potentialStartTime, end: potentialEndTime },
                    { start: apt.start, end: apt.end },
                    { inclusive: false }
                )
            );

            if (!isOverlapping) {
                options.push(format(potentialStartTime, 'HH:mm'));
            }

            currentTime = addMinutes(currentTime, bookingInterval);
        }
        
        const originalTimeFormatted = format(appointment.startTime, 'HH:mm');
        if (!options.includes(originalTimeFormatted) && isSameDay(appointment.startTime, rescheduleDate)) {
            options.unshift(originalTimeFormatted);
            options.sort();
        }

        return options;
    }, [rescheduleDate, service, appointments, appointment.id, appointment.startTime, appointment.staffId, services, publicScheduleProfile, staff, assignedStaff]);


    const handleSubmit = () => {
        if (!client || !service || !rescheduleDate || !rescheduleTime) return;

        const [hours, minutes] = rescheduleTime.split(':').map(Number);
        const startDateTime = setMinutes(setHours(startOfDay(rescheduleDate), hours), minutes);

        const endDateTime = new Date(startDateTime.getTime() + (service.duration * 60000));

        const updatedAppointment: Appointment = {
            ...appointment,
            startTime: startDateTime,
            endTime: endDateTime,
        };
        
        onConfirm(updatedAppointment);
    }
    
    return (
        <form id="reschedule-appointment-form" onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
            <div className="space-y-6">
                {isWithinCancellationWindow && (
                    <Alert className="bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-400 border-2 shadow-sm">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle className="text-xs font-black uppercase tracking-tight">Policy Alert: Late Reschedule</AlertTitle>
                        <AlertDescription className="text-xs">
                            This appointment is within the {tenant?.cancellationWindowHours}-hour window. Consider if a late-move fee of ${tenant?.cancellationFee?.toFixed(2)} should be applied.
                        </AlertDescription>
                    </Alert>
                )}

                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-4">
                            <Avatar className="w-12 h-12">
                                <AvatarImage src={client.avatarUrl} alt={client.name} />
                                <AvatarFallback>{client.name.substring(0, 2)}</AvatarFallback>
                            </Avatar>
                            <div>
                                <p className="font-semibold">{client.name}</p>
                                <p className="text-sm text-muted-foreground">{service.name}</p>
                                {assignedStaff && (
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground pt-1">
                                        <Avatar className="w-5 h-5">
                                            <AvatarImage src={assignedStaff.avatarUrl} />
                                            <AvatarFallback>{assignedStaff.name.charAt(0)}</AvatarFallback>
                                        </Avatar>
                                        <span>{assignedStaff.name}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <div className="space-y-4">
                    <h3 className="text-lg font-medium">New Date & Time</h3>
                    <div className="space-y-2">
                        <Label>Date</Label>
                        <div className="rounded-lg border p-4 space-y-4">
                            <div className="flex justify-between items-center">
                                <Button variant="outline" size="icon" className="h-8 w-8" onClick={handlePreviousWeek} type="button"><ChevronLeft className="w-4 h-4"/></Button>
                                <span className="font-semibold">{format(rescheduleDate, 'MMMM yyyy')}</span>
                                <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleNextWeek}><ChevronRight className="w-4 h-4"/></Button>
                            </div>
                            <div className="grid grid-cols-7 gap-2">
                                {weekDays.map(day => (
                                    <button
                                        key={day.toISOString()}
                                        onClick={() => handleDateSelect(day)}
                                        disabled={isDayClosed(day)}
                                        type="button"
                                        className={cn(
                                            "flex flex-col items-center justify-center p-2 rounded-lg border w-full aspect-square transition-colors",
                                            isSameDay(day, rescheduleDate)
                                                ? "bg-primary text-primary-foreground border-primary"
                                                : "bg-background hover:bg-accent",
                                            isDayClosed(day) && "bg-muted/50 text-muted-foreground cursor-not-allowed"
                                        )}
                                    >
                                        <span className="text-xs">{format(day, 'E')}</span>
                                        <span className="font-bold text-lg">{format(day, 'd')}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                    
                    <div>
                        <div className="flex justify-between items-center mb-2">
                            <h3 className="font-semibold text-foreground">Select Time</h3>
                            <span className="text-sm text-muted-foreground">{timeSlots.length} Slots</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            {timeSlots.map(slot => (
                                <Button 
                                    key={slot} 
                                    type="button"
                                    variant={rescheduleTime === slot ? 'default' : 'outline'}
                                    onClick={() => setRescheduleTime(slot)}
                                >
                                    {format(parseISO(`1970-01-01T${slot}:00`), 'h:mm a')}
                                </Button>
                            ))}
                            {timeSlots.length === 0 && <p className="col-span-3 text-center text-sm text-muted-foreground py-4">No available slots for this day.</p>}
                        </div>
                    </div>
                </div>
            </div>
        </form>
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
    onConfirm: (apt: Appointment) => void 
}) => {
  const isMobile = useIsMobile();
  const { events } = useInventory();
  const client = clients.find(c => c.id === appointment.clientId);
  const service = services.find(s => s.id === appointment.serviceId);

  if (!client || !service) return null;

  const title = "Reschedule Appointment";
  const description = "Select a new date and time for this appointment.";
  
  const FormContent = <RescheduleAppointmentForm appointment={appointment} client={client} service={service} appointments={appointments} services={services} onConfirm={onConfirm} />;

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[95vh] flex flex-col">
          <SheetHeader className="text-left px-4">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>
          <div className="py-4 flex-1 overflow-y-auto px-4">{FormContent}</div>
          <SheetFooter className="px-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" form="reschedule-appointment-form" className="w-full">Save Changes</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
         <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="py-4">{FormContent}</div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="reschedule-appointment-form">Save Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
