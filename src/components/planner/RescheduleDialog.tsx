

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
import { CalendarIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Client, Service, Appointment } from '@/lib/data';
import { format, setHours, setMinutes, startOfDay, areIntervalsOverlapping, addMinutes } from 'date-fns';
import { Card, CardContent } from '../ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Switch } from '../ui/switch';
import { useToast } from '@/hooks/use-toast';

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
                <button
                    className={cn(buttonVariants({ variant: 'outline' }), "w-full justify-start text-left font-normal h-12", !date && "text-muted-foreground")}
                     onClick={() => setIsOpen(true)}
                >
                    {TriggerContent}
                </button>
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
            <PopoverTrigger className={cn(buttonVariants({ variant: 'outline' }), "w-full justify-start text-left font-normal h-12", !date && "text-muted-foreground")}>
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
    const [date, setDate] = useState<Date>(appointment.startTime);
    const [startTime, setStartTime] = useState<string>(format(appointment.startTime, 'HH:mm'));
    const [sendNotification, setSendNotification] = useState(true);
    const { toast } = useToast();

    const timeOptions = useMemo(() => {
        const options = [];
        if (!service || !date) return [];

        const dayStart = setHours(startOfDay(date), 0);
        const dayEnd = setHours(startOfDay(date), 24);
        
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
        if (sendNotification) {
            toast({
                title: "Reschedule Email Sent",
                description: `A notification has been sent to ${client.email}.`
            })
        }
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
                        <Label htmlFor="reschedule-date">Date</Label>
                        <DatePicker date={date} onDateChange={setDate} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="reschedule-start-time">Start Time</Label>
                        <Select onValueChange={setStartTime} value={startTime}>
                            <SelectTrigger id="reschedule-start-time" className="h-12">
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
                
                 <div className="flex items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                        <Label>Send Reschedule Email</Label>
                        <p className="text-xs text-muted-foreground">Notify the client of this change.</p>
                    </div>
                    <Switch
                        checked={sendNotification}
                        onCheckedChange={setSendNotification}
                    />
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
