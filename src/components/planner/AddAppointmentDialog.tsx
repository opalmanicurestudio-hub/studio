
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import { CalendarIcon, PlusCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Client, Service, Appointment } from '@/lib/data';
import { format, setHours, setMinutes, startOfDay, areIntervalsOverlapping, addMinutes } from 'date-fns';

const AddAppointmentForm = ({ 
    clients, 
    services,
    appointments,
    onConfirm
}: { 
    clients: Client[], 
    services: Service[],
    appointments: Appointment[],
    onConfirm: (apt: Omit<Appointment, 'id'>) => void
}) => {
    const [selectedClientId, setSelectedClientId] = useState<string>('');
    const [selectedServiceId, setSelectedServiceId] = useState<string>('');
    const [date, setDate] = useState<Date>(new Date());
    const [startTime, setStartTime] = useState<string>('');

    const selectedService = useMemo(() => services.find(s => s.id === selectedServiceId), [services, selectedServiceId]);

    const timeOptions = useMemo(() => {
        const options = [];
        if (!selectedService || !date) return [];

        const dayStart = setHours(startOfDay(date), 8);
        const dayEnd = setHours(startOfDay(date), 22);
        
        const existingAppointmentsOnDate = appointments.filter(
            apt => format(apt.startTime, 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd')
        ).map(apt => {
            const service = services.find(s => s.id === apt.serviceId);
            const padBefore = service?.padBefore || 0;
            const padAfter = service?.padAfter || 0;
            return {
                start: addMinutes(apt.startTime, -padBefore),
                end: addMinutes(apt.endTime, padAfter)
            }
        });

        for (let i = dayStart.getTime(); i < dayEnd.getTime(); i += 15 * 60000) {
            const potentialStartTime = new Date(i);
            
            const totalDuration = selectedService.duration + (selectedService.padBefore || 0) + (selectedService.padAfter || 0);
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
        return options;
    }, [date, selectedService, appointments, services]);

    const handleSubmit = () => {
        if (!selectedClientId || !selectedService || !date || !startTime) return;

        const [hours, minutes] = startTime.split(':').map(Number);
        const startDateTime = setMinutes(setHours(startOfDay(date), hours), minutes);

        const endDateTime = new Date(startDateTime.getTime() + (selectedService.duration * 60000));

        const newAppointment: Omit<Appointment, 'id'> = {
            clientId: selectedClientId,
            serviceId: selectedServiceId,
            startTime: startDateTime,
            endTime: endDateTime,
            status: 'confirmed'
        };
        onConfirm(newAppointment);
    }
    
    return (
        <form id="add-appointment-form" onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
            <ScrollArea className="h-[70vh] pr-6">
                <div className="space-y-6">
                    <div className="space-y-4">
                        <h3 className="text-lg font-medium">Client & Service</h3>
                        <div className="space-y-2">
                            <Label htmlFor="client">Client</Label>
                            <div className="flex gap-2">
                                <Select onValueChange={setSelectedClientId}>
                                    <SelectTrigger id="client">
                                    <SelectValue placeholder="Select an existing client" />
                                    </SelectTrigger>
                                    <SelectContent>
                                    {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                                <Button variant="outline" size="icon"><PlusCircle className="h-4 w-4" /></Button>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="service">Service</Label>
                            <Select onValueChange={setSelectedServiceId}>
                                <SelectTrigger id="service">
                                <SelectValue placeholder="Select a service" />
                                </SelectTrigger>
                                <SelectContent>
                                {services.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <h3 className="text-lg font-medium">Date & Time</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="birthday">Date</Label>
                                <Popover>
                                    <PopoverTrigger asChild>
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
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0">
                                    <Calendar
                                        mode="single"
                                        selected={date}
                                        onSelect={(d) => setDate(d || new Date())}
                                        initialFocus
                                    />
                                    </PopoverContent>
                                </Popover>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="start-time">Start Time</Label>
                                <Select onValueChange={setStartTime} value={startTime}>
                                    <SelectTrigger id="start-time" disabled={!selectedService}>
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

                    <div className="space-y-4">
                        <h3 className="text-lg font-medium">Notes</h3>
                        <Textarea rows={4} placeholder="Add any appointment-specific notes..."/>
                    </div>
                </div>
            </ScrollArea>
        </form>
    )
}

export const AddAppointmentDialog = ({ open, onOpenChange, clients, services, appointments, onConfirm }: { open: boolean, onOpenChange: (open: boolean) => void, clients: Client[], services: Service[], appointments: Appointment[], onConfirm: (apt: Omit<Appointment, 'id'>) => void }) => {
  const isMobile = useIsMobile();

  const title = "New Appointment";
  const description = "Book a new appointment for a client.";
  
  const FormContent = <AddAppointmentForm clients={clients} services={services} appointments={appointments} onConfirm={onConfirm} />;

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
            <Button type="submit" form="add-appointment-form" className="w-full">Book Appointment</Button>
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
          <Button type="submit" form="add-appointment-form">Book Appointment</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
