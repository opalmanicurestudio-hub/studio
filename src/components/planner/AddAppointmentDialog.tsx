

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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { CalendarIcon, PlusCircle, Trash2, AlertTriangle } from 'lucide-react';
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
            onClick={() => setIsOpen(true)}
        >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {date ? format(date, 'PPP') : <span>Pick a date</span>}
        </Button>
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
                {TriggerButton}
                <Sheet open={isOpen} onOpenChange={setIsOpen}>
                    <SheetContent side="bottom" className="h-auto">
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
            <PopoverTrigger asChild>
                {TriggerButton}
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0">
                {CalendarComponent}
            </PopoverContent>
        </Popover>
    );
};

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
    const [selectedAddOns, setSelectedAddOns] = useState<Service[]>([]);
    const [isAddOnSelectorOpen, setIsAddOnSelectorOpen] = useState(false);

    const [isOverlapping, setIsOverlapping] = useState(false);
    const [showConfirmation, setShowConfirmation] = useState(false);

    const selectedService = useMemo(() => services.find(s => s.id === selectedServiceId), [services, selectedServiceId]);

    const timeOptions = useMemo(() => {
        const options = [];
        if (!date) return [];
        const dayStart = startOfDay(date);
        for (let i = 0; i < 24 * 4; i++) { // 24 hours * 4 slots per hour (15 min)
            const minutes = i * 15;
            const time = addMinutes(dayStart, minutes);
            options.push(format(time, 'HH:mm'));
        }
        return options;
    }, [date]);

    useEffect(() => {
        if (!selectedService || !date || !startTime) {
            setIsOverlapping(false);
            return;
        }

        const [hours, minutes] = startTime.split(':').map(Number);
        const startDateTime = setMinutes(setHours(startOfDay(date), hours), minutes);
        
        const totalDuration = selectedService.duration + (selectedService.padBefore || 0) + (selectedService.padAfter || 0);
        const endDateTime = addMinutes(startDateTime, totalDuration);

        const newInterval = { start: startDateTime, end: endDateTime };

        const hasOverlap = appointments.some(apt => {
            const service = services.find(s => s.id === apt.serviceId);
            const padBefore = service?.padBefore || 0;
            const padAfter = service?.padAfter || 0;
            const aptInterval = { 
                start: addMinutes(apt.startTime, -padBefore), 
                end: addMinutes(apt.endTime, padAfter) 
            };
            return areIntervalsOverlapping(newInterval, aptInterval, { inclusive: false });
        });

        setIsOverlapping(hasOverlap);
    }, [date, startTime, selectedService, appointments, services]);

    const confirmAndSubmit = () => {
        if (!selectedClientId || !selectedService || !date || !startTime) return;

        const [hours, minutes] = startTime.split(':').map(Number);
        const startDateTime = setMinutes(setHours(startOfDay(date), hours), minutes);

        const endDateTime = new Date(startDateTime.getTime() + (selectedService.duration * 60000));

        const newAppointment: Omit<Appointment, 'id'> = {
            clientId: selectedClientId,
            serviceId: selectedServiceId,
            startTime: startDateTime,
            endTime: endDateTime,
            status: 'confirmed',
            addOnIds: selectedAddOns.map(s => s.id),
        };
        onConfirm(newAppointment);
    }
    
    const handleSaveAttempt = () => {
        if (!selectedClientId || !selectedServiceId || !startTime) {
            // Basic validation, could be improved with toasts
            return;
        }
        if (isOverlapping) {
            setShowConfirmation(true);
        } else {
            confirmAndSubmit();
        }
    };

    const removeAddOn = (addOnId: string) => {
        setSelectedAddOns(prev => prev.filter(a => a.id !== addOnId));
    };
    
    return (
        <>
            <form id="add-appointment-form" onSubmit={(e) => { e.preventDefault(); handleSaveAttempt(); }}>
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
                                    <Label htmlFor="date">Date</Label>
                                    <DatePicker date={date} onDateChange={setDate} />
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
                             {isOverlapping && (
                                <Alert variant="destructive" className="mt-2">
                                    <AlertTriangle className="h-4 w-4" />
                                    <AlertTitle>Potential Double Booking</AlertTitle>
                                    <AlertDescription>
                                        This time slot overlaps with an existing appointment.
                                    </AlertDescription>
                                </Alert>
                            )}
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
             <AlertDialog open={showConfirmation} onOpenChange={setShowConfirmation}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                    <AlertDialogTitle>Confirm Double Booking</AlertDialogTitle>
                    <AlertDialogDescription>
                        You are about to schedule an appointment that overlaps with an existing one. Are you sure you want to proceed?
                    </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={confirmAndSubmit}>Book Anyway</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
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
