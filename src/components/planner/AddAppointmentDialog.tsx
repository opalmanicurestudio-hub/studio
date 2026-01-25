

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
import { Button, buttonVariants } from '@/components/ui/button';
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
import { Client, Service, Appointment, Staff } from '@/lib/data';
import { format, setHours, setMinutes, startOfDay, areIntervalsOverlapping, addMinutes } from 'date-fns';
import { SelectAddOnsDialog } from '../services/SelectAddOnsDialog';
import { Card, CardContent } from '../ui/card';
import { nanoid } from 'nanoid';
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
                    className={cn("w-full justify-start text-left font-normal", !date && "text-muted-foreground")}
                    onClick={() => setIsOpen(true)}
                >
                    {TriggerContent}
                </Button>
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
            <PopoverTrigger className={cn(buttonVariants({ variant: 'outline' }), "w-full justify-start text-left font-normal", !date && "text-muted-foreground")}>
                {TriggerContent}
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0">
                {CalendarComponent}
            </PopoverContent>
        </Popover>
    );
};

interface AddAppointmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clients: Client[];
  services: Service[];
  staff: Staff[];
  appointments: Appointment[];
  onConfirm: (apt: Omit<Appointment, 'id'>) => void;
  initialClientId?: string;
  appointmentToRebook?: Appointment | null;
}

const AddAppointmentForm = ({ 
    clients, 
    services,
    staff,
    appointments,
    onConfirm,
    initialClientId,
    appointmentToRebook,
}: Omit<AddAppointmentDialogProps, 'open' | 'onOpenChange'>) => {
    const [selectedClientId, setSelectedClientId] = useState<string>(() => appointmentToRebook ? appointmentToRebook.clientId : initialClientId || '');
    const [selectedServiceId, setSelectedServiceId] = useState<string>(() => appointmentToRebook ? appointmentToRebook.serviceId : '');
    const [selectedStaffId, setSelectedStaffId] = useState<string>(() => appointmentToRebook ? (appointmentToRebook.staffId || staff[0]?.id || '') : (staff[0]?.id || ''));
    const [date, setDate] = useState<Date>(() => appointmentToRebook ? new Date(appointmentToRebook.startTime) : new Date());
    const [startTime, setStartTime] = useState<string>('');
    const [selectedAddOns, setSelectedAddOns] = useState<Service[]>(() => {
        if (!appointmentToRebook) return [];
        return (appointmentToRebook.addOnIds || [])
            .map(id => services.find(s => s.id === id))
            .filter((s): s is Service => !!s);
    });

    const [isAddOnSelectorOpen, setIsAddOnSelectorOpen] = useState(false);
    const [isOverlapping, setIsOverlapping] = useState(false);
    const [showConfirmation, setShowConfirmation] = useState(false);
    
    const selectedService = useMemo(() => services.find(s => s.id === selectedServiceId), [services, selectedServiceId]);
    const selectedClient = useMemo(() => clients.find(c => c.id === selectedClientId), [clients, selectedClientId]);
    const selectedStaff = useMemo(() => staff.find(s => s.id === selectedStaffId), [staff, selectedStaffId]);

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
            return areIntervalsOverlapping(newInterval, { 
                start: addMinutes(apt.startTime, -padBefore), 
                end: addMinutes(apt.endTime, padAfter) 
            }, { inclusive: false });
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
            staffId: selectedStaffId,
            startTime: startDateTime,
            endTime: endDateTime,
            status: 'confirmed',
            addOnIds: selectedAddOns.map(s => s.id),
            checkInToken: nanoid(16),
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
                <div className="space-y-6">
                    <div className="space-y-4">
                        <h3 className="text-lg font-medium">Client & Service</h3>
                        <div className="space-y-2">
                            <Label htmlFor="client">Client</Label>
                            <div className="flex gap-2">
                                <Select value={selectedClientId} onValueChange={setSelectedClientId}>
                                    <SelectTrigger id="client">
                                        <SelectValue asChild>
                                            {selectedClient ? (
                                                <div className="flex items-center gap-2">
                                                    <Avatar className="w-6 h-6">
                                                        <AvatarImage src={selectedClient.avatarUrl} />
                                                        <AvatarFallback>{selectedClient.name.charAt(0)}</AvatarFallback>
                                                    </Avatar>
                                                    <span>{selectedClient.name}</span>
                                                </div>
                                            ) : (
                                                <span>Select an existing client</span>
                                            )}
                                        </SelectValue>
                                    </SelectTrigger>
                                    <SelectContent>
                                    {clients.map(c => (
                                        <SelectItem key={c.id} value={c.id}>
                                            <div className="flex items-center gap-2">
                                                <Avatar className="w-6 h-6">
                                                    <AvatarImage src={c.avatarUrl} />
                                                    <AvatarFallback>{c.name.charAt(0)}</AvatarFallback>
                                                </Avatar>
                                                <span>{c.name}</span>
                                            </div>
                                        </SelectItem>
                                    ))}
                                    </SelectContent>
                                </Select>
                                <Button variant="outline" size="icon"><PlusCircle className="h-4 w-4" /></Button>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="staff">Staff Member</Label>
                            <Select value={selectedStaffId} onValueChange={setSelectedStaffId}>
                                <SelectTrigger id="staff">
                                     <SelectValue asChild>
                                        {selectedStaff ? (
                                            <div className="flex items-center gap-2">
                                                <Avatar className="w-6 h-6">
                                                    <AvatarImage src={selectedStaff.avatarUrl} />
                                                    <AvatarFallback>{selectedStaff.name.charAt(0)}</AvatarFallback>
                                                </Avatar>
                                                <span>{selectedStaff.name}</span>
                                            </div>
                                        ) : (
                                            <span>Select a staff member</span>
                                        )}
                                    </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                {staff.map(s => (
                                    <SelectItem key={s.id} value={s.id}>
                                        <div className="flex items-center gap-2">
                                            <Avatar className="w-6 h-6">
                                                <AvatarImage src={s.avatarUrl} />
                                                <AvatarFallback>{s.name.charAt(0)}</AvatarFallback>
                                            </Avatar>
                                            <span>{s.name}</span>
                                        </div>
                                    </SelectItem>
                                ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="service">Service</Label>
                            <Select value={selectedServiceId} onValueChange={setSelectedServiceId}>
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

export const AddAppointmentDialog: React.FC<AddAppointmentDialogProps> = ({ open, onOpenChange, clients, services, staff, appointments, onConfirm, initialClientId, appointmentToRebook }) => {
  const isMobile = useIsMobile();

  const formKey = useMemo(() => {
    return appointmentToRebook ? `rebook-${appointmentToRebook.id}` : `new-${initialClientId || 'fresh'}`;
  }, [appointmentToRebook, initialClientId]);

  const title = "New Appointment";
  const description = "Book a new appointment for a client.";
  
  const FormContent = <AddAppointmentForm 
    key={formKey}
    clients={clients} 
    services={services} 
    staff={staff}
    appointments={appointments} 
    onConfirm={onConfirm} 
    initialClientId={initialClientId} 
    appointmentToRebook={appointmentToRebook}
    />;

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
            <Button type="submit" form="add-appointment-form" className="w-full">Book Appointment</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] flex flex-col p-0">
         <DialogHeader className="p-6 pb-4">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-6">
            {FormContent}
        </div>
        <DialogFooter className="p-6 pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="add-appointment-form">Book Appointment</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
