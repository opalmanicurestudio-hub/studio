
'use client';

import React, 'use client';
import { useState, useMemo, useEffect } from 'react';
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
  SheetTrigger,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
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
import { ScrollArea } from '@/components/ui/scroll-area';
import { CalendarIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Client, Service, Appointment } from '@/lib/data';
import { format, setHours, setMinutes, startOfDay, areIntervalsOverlapping, addMinutes } from 'date-fns';
import { Card, CardContent } from '../ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';

const DatePicker = ({ date, onDateChange }: { date: Date, onDateChange: (date: Date) => void }) => {
    const isMobile = useIsMobile();
    const [isOpen, setIsOpen] = useState(false);

    const handleSelect = (selectedDate: Date | undefined) => {
        if (selectedDate) {
            onDateChange(selectedDate);
            setIsOpen(false);
        }
    }
    
    const TriggerButton = (
        <Button
            variant={"outline"}
            className={cn(
            "w-full justify-start text-left font-normal",
            !date && "text-muted-foreground"
            )}
        >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {date ? format(date, 'PPP') : <span>Pick a date</span>}
        </Button>
    );

    if (isMobile) {
        return (
            <Sheet open={isOpen} onOpenChange={setIsOpen}>
                <SheetTrigger asChild>{TriggerButton}</SheetTrigger>
                <SheetContent side="bottom">
                    <Calendar
                        mode="single"
                        selected={date}
                        onSelect={handleSelect}
                        classNames={{
                            caption_label: "text-base font-medium",
                            day: "h-9 w-9",
                            day_selected: "rounded-md",
                            day_today: "rounded-md",
                        }}
                    />
                </SheetContent>
            </Sheet>
        );
    }

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
                {TriggerButton}
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0">
                <Calendar
                    mode="single"
                    selected={date}
                    onSelect={handleSelect}
                    initialFocus
                    classNames={{
                        caption_label: "text-base font-medium",
                        day: "h-9 w-9",
                        day_selected: "rounded-md",
                        day_today: "rounded-md",
                    }}
                />
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
    const [date, setDate] = useState<Date>(appointment.startTime);
    const [startTime, setStartTime] = useState<string>(format(appointment.startTime, 'HH:mm'));

    const timeOptions = useMemo(() => {
        const options = [];
        if (!service || !date) return [];

        const dayStart = setHours(startOfDay(date), 8);
        const dayEnd = setHours(startOfDay(date), 22);
        
        const existingAppointmentsOnDate = appointments.filter(
            apt => apt.id !== appointment.id && format(apt.startTime, 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd')
        ).map(apt => {
            const aptService = services.find(s => s.id === apt.serviceId);
            const padBefore = aptService?.padBefore || 0;
            const padAfter = aptService?.padAfter || 0;
            return {
                start: addMinutes(apt.startTime, -padBefore),
                end: addMinutes(apt.endTime, padAfter)
            }
        });

        for (let i = dayStart.getTime(); i < dayEnd.getTime(); i += 15 * 60000) {
            const potentialStartTime = new Date(i);
            
            const totalDuration = service.duration + (service.padBefore || 0) + (service.padAfter || 0);
            const potentialEndTime = addMinutes(potentialStartTime, totalDuration);

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
        }
        
        const originalTimeFormatted = format(appointment.startTime, 'HH:mm');
        if (!options.includes(originalTimeFormatted) && format(appointment.startTime, 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd')) {
            options.unshift(originalTimeFormatted);
            options.sort();
        }

        return options;
    }, [date, service, appointments, appointment.id, appointment.startTime, services]);

    const handleSubmit = () => {
        if (!client || !service || !date || !startTime) return;

        const [hours, minutes] = startTime.split(':').map(Number);
        const startDateTime = setMinutes(setHours(startOfDay(date), hours), minutes);

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
            <ScrollArea className="h-[70vh] pr-6">
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
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="reschedule-date">Date</Label>
                                <DatePicker date={date} onDateChange={setDate} />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="reschedule-start-time">Start Time</Label>
                                <Select onValueChange={setStartTime} value={startTime}>
                                    <SelectTrigger id="reschedule-start-time">
                                        <SelectValue placeholder="Select a time" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {timeOptions.map(time => (
                                            <SelectItem key={time} value={time}>{format(setMinutes(setHours(new Date(), parseInt(time.split(':')[0])), parseInt(time.split(':')[1])), 'h:mm a')}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>
                </div>
            </ScrollArea>
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
        <SheetContent side="bottom" className="h-[95dvh]">
          <SheetHeader className="text-left">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>
          <div className="py-4">{FormContent}</div>
          <SheetFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" form="reschedule-appointment-form" className="w-full">Save Changes</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
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
