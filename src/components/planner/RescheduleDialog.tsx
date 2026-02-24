
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Client, Service, Appointment } from '@/lib/data';
import { format, setHours, setMinutes, startOfDay, areIntervalsOverlapping, addMinutes, startOfWeek, addDays, subWeeks, addWeeks, eachDayOfInterval, isSameDay, isBefore, isToday, parseISO } from 'date-fns';
import { Card, CardContent } from '../ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Switch } from '../ui/switch';
import { useToast } from '@/hooks/use-toast';
import { useInventory } from '@/context/InventoryContext';

const DatePicker = ({ date, onDateChange }: { date: Date, onDateChange: (date: Date) => void }) => {
    const isMobile = useIsMobile();
    const [isOpen, setIsOpen] = useState(false);

    const handleSelect = (selectedDate: Date | undefined) => {
        if (selectedDate) {
            onDateChange(selectedDate);
            setIsOpen(false);
        }
    }
    
    const TriggerContent = (
        <span className="flex items-center">
            <CalendarIcon className="mr-2 h-4 w-4" />
            {date ? format(date, 'PPP') : "Pick a date"}
        </span>
    );
    
    const CalendarComponent = (
        <Calendar
            mode="single"
            selected={date}
            onSelect={handleSelect}
            initialFocus
            classNames={{
                caption_label: "text-base font-medium",
                day: "h-10 w-10",
                day_selected: "rounded-md",
                day_today: "rounded-md",
            }}
        />
    );

    if (isMobile) {
        return (
            <>
                <Button
                    variant="outline"
                    className={cn("w-full justify-start text-left font-normal h-12", !date && "text-muted-foreground")}
                     onClick={() => setIsOpen(true)}
                >
                    {TriggerContent}
                </Button>
                 <Sheet open={isOpen} onOpenChange={setIsOpen}>
                    <SheetContent side="bottom">
                         <SheetHeader className="text-left">
                            <SheetTitle>Select Date</SheetTitle>
                        </SheetHeader>
                        <div className="flex justify-center py-4">
                            {CalendarComponent}
                        </div>
                    </SheetContent>
                </Sheet>
            </>
        )
    }

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger
                className={cn(
                    buttonVariants({ variant: "outline" }),
                    "w-full justify-start text-left font-normal h-12",
                    !date && "text-muted-foreground"
                )}
            >
                {TriggerContent}
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0">
                {CalendarComponent}
            </PopoverContent>
        </Popover>
    );
};

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
    const { scheduleProfiles } = useInventory();
    const publicScheduleProfile = scheduleProfiles[0];
    const [rescheduleDate, setRescheduleDate] = useState(appointment.startTime);
    const [rescheduleTime, setRescheduleTime] = useState<string>(format(appointment.startTime, 'HH:mm'));

    const weekStart = useMemo(() => startOfWeek(rescheduleDate), [rescheduleDate]);
    const weekDays = useMemo(() => eachDayOfInterval({ start: weekStart, end: addDays(weekStart, 6) }), [weekStart]);

    const handlePreviousWeek = () => setRescheduleDate(prev => subWeeks(prev, 1));
    const handleNextWeek = () => setRescheduleDate(prev => addWeeks(prev, 1));
    const handleDateSelect = (day: Date) => setRescheduleDate(day);

     const isDayClosed = (day: Date) => {
        if (!publicScheduleProfile) return true;
        const dayName = format(day, 'eeee').toLowerCase();
        const dayHours = publicScheduleProfile.week[dayName];
        return !dayHours || !dayHours.enabled;
    }

    const timeSlots = useMemo(() => {
        if (!service || !rescheduleDate || !appointments || !services || !publicScheduleProfile) return [];

        const bookingInterval = publicScheduleProfile.bookingSlotInterval || 15;
        const dayName = format(rescheduleDate, 'eeee').toLowerCase();
        const dayHours = publicScheduleProfile.week[dayName];

        if (!dayHours || !dayHours.enabled) {
          return [];
        }

        const openTime = timeStringToDate(dayHours.start, rescheduleDate);
        const closeTime = timeStringToDate(dayHours.end, rescheduleDate);
        
        const existingAppointmentsOnDate = appointments.filter(
            apt => apt.id !== appointment.id && isSameDay(apt.startTime, rescheduleDate)
        ).map(apt => {
            const service = services.find(s => s.id === apt.serviceId);
            const padBefore = service?.padBefore || 0;
            const padAfter = service?.padAfter || 0;
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
    }, [rescheduleDate, service, appointments, appointment.id, appointment.startTime, services, publicScheduleProfile]);


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
                                <Button variant="outline" size="icon" className="h-8 w-8" onClick={handlePreviousWeek}><ChevronLeft className="w-4 h-4"/></Button>
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
    )
}

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
