
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
import { CalendarIcon, PlusCircle, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Client, Service, Appointment } from '@/lib/data';
import { format, setHours, setMinutes, startOfDay, areIntervalsOverlapping, addMinutes } from 'date-fns';
import { SelectAddOnsDialog } from '../services/SelectAddOnsDialog';
import { Card, CardContent } from '../ui/card';

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

const EditAppointmentForm = ({ 
    appointment,
    clients, 
    services,
    appointments,
    onConfirm
}: { 
    appointment: Appointment;
    clients: Client[];
    services: Service[];
    appointments: Appointment[];
    onConfirm: (apt: Appointment) => void;
}) => {
    const [selectedClientId, setSelectedClientId] = useState<string>(appointment.clientId);
    const [selectedServiceId, setSelectedServiceId] = useState<string>(appointment.serviceId);
    const [date, setDate] = useState<Date>(appointment.startTime);
    const [startTime, setStartTime] = useState<string>(format(appointment.startTime, 'HH:mm'));
    const [selectedAddOns, setSelectedAddOns] = useState<Service[]>([]);
    const [isAddOnSelectorOpen, setIsAddOnSelectorOpen] = useState(false);

    const selectedService = useMemo(() => services.find(s => s.id === selectedServiceId), [services, selectedServiceId]);

    useEffect(() => {
        setSelectedClientId(appointment.clientId);
        setSelectedServiceId(appointment.serviceId);
        setDate(appointment.startTime);
        setStartTime(format(appointment.startTime, 'HH:mm'));
        const initialAddons = (appointment.addOnIds || [])
            .map(id => services.find(s => s.id === id))
            .filter((s): s is Service => !!s);
        setSelectedAddOns(initialAddons);
    }, [appointment, services]);

    const timeOptions = useMemo(() => {
        const options = [];
        if (!selectedService || !date) return [];

        const dayStart = setHours(startOfDay(date), 8);
        const dayEnd = setHours(startOfDay(date), 22);
        
        const existingAppointmentsOnDate = appointments.filter(
            apt => apt.id !== appointment.id && format(apt.startTime, 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd')
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
        
        const originalTimeFormatted = format(appointment.startTime, 'HH:mm');
        if (!options.includes(originalTimeFormatted) && format(appointment.startTime, 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd')) {
            options.unshift(originalTimeFormatted);
            options.sort();
        }

        return options;
    }, [date, selectedService, appointments, services, appointment.id, appointment.startTime]);

    const handleSubmit = () => {
        if (!selectedClientId || !selectedService || !date || !startTime) return;

        const [hours, minutes] = startTime.split(':').map(Number);
        const startDateTime = setMinutes(setHours(startOfDay(date), hours), minutes);

        const endDateTime = new Date(startDateTime.getTime() + (selectedService.duration * 60000));

        const updatedAppointment: Appointment = {
            ...appointment,
            clientId: selectedClientId,
            serviceId: selectedServiceId,
            startTime: startDateTime,
            endTime: endDateTime,
            addOnIds: selectedAddOns.map(s => s.id),
        };
        onConfirm(updatedAppointment);
    }

    const removeAddOn = (addOnId: string) => {
        setSelectedAddOns(prev => prev.filter(a => a.id !== addOnId));
    };
    
    return (
        <>
            <form id="edit-appointment-form" onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
                <ScrollArea className="h-[70vh] pr-6">
                    <div className="space-y-6">
                        <div className="space-y-4">
                            <h3 className="text-lg font-medium">Client & Service</h3>
                            <div className="space-y-2">
                                <Label htmlFor="client-edit">Client</Label>
                                <div className="flex gap-2">
                                    <Select value={selectedClientId} onValueChange={setSelectedClientId}>
                                        <SelectTrigger id="client-edit">
                                        <SelectValue placeholder="Select an existing client" />
                                        </SelectTrigger>
                                        <SelectContent>
                                        {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="service-edit">Service</Label>
                                <Select value={selectedServiceId} onValueChange={setSelectedServiceId}>
                                    <SelectTrigger id="service-edit">
                                    <SelectValue placeholder="Select a service" />
                                    </SelectTrigger>
                                    <SelectContent>
                                    {services.filter(s => s.type === 'service').map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                         <div className="space-y-4">
                            <h3 className="text-lg font-medium">Add-on Services</h3>
                                {selectedAddOns.length > 0 ? (
                                <Card>
                                    <CardContent className="p-2 space-y-2">
                                        {selectedAddOns.map(item => (
                                            <div key={item.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50">
                                                <span className="text-sm font-medium">{item.name}</span>
                                                <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeAddOn(item.id)}>
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        ))}
                                    </CardContent>
                                </Card>
                            ) : (
                                <Card>
                                    <CardContent className="p-4 text-center text-sm text-muted-foreground">
                                        No add-ons selected.
                                    </CardContent>
                                </Card>
                            )}
                            <Button variant="outline" onClick={() => setIsAddOnSelectorOpen(true)} type="button"><PlusCircle className="mr-2 h-4 w-4" /> Select Add-ons</Button>
                        </div>


                        <div className="space-y-4">
                            <h3 className="text-lg font-medium">Date & Time</h3>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="date-edit">Date</Label>
                                    <DatePicker date={date} onDateChange={setDate} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="start-time-edit">Start Time</Label>
                                    <Select onValueChange={setStartTime} value={startTime}>
                                        <SelectTrigger id="start-time-edit" disabled={!selectedService}>
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
             <SelectAddOnsDialog
                open={isAddOnSelectorOpen}
                onOpenChange={setIsAddOnSelectorOpen}
                onSelect={setSelectedAddOns}
                allAddOns={services.filter(s => s.type === 'addon')}
                initialSelected={selectedAddOns}
            />
        </>
    )
}

export const EditAppointmentDialog = ({ open, onOpenChange, appointment, clients, services, appointments, onConfirm }: { open: boolean, onOpenChange: (open: boolean) => void, appointment: Appointment, clients: Client[], services: Service[], appointments: Appointment[], onConfirm: (apt: Appointment) => void }) => {
  const isMobile = useIsMobile();

  const title = "Edit Appointment";
  const description = "Modify the details for this appointment.";
  
  const FormContent = <EditAppointmentForm appointment={appointment} clients={clients} services={services} appointments={appointments} onConfirm={onConfirm} />;

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
            <Button type="submit" form="edit-appointment-form" className="w-full">Save Changes</Button>
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
          <Button type="submit" form="edit-appointment-form">Save Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
