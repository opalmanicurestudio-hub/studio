

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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CalendarIcon, PlusCircle, Trash2, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Client, Service, Appointment, Staff, Event } from '@/lib/data';
import { format, setHours, setMinutes, startOfDay, areIntervalsOverlapping, addMinutes, startOfWeek, subWeeks, addWeeks, eachDayOfInterval, isSameDay, isBefore, getDay, parse, isToday, addDays } from 'date-fns';
import { SelectAddOnsDialog } from '../services/SelectAddOnsDialog';
import { Card, CardContent } from '../ui/card';
import { nanoid } from 'nanoid';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Calendar } from '../ui/calendar';

interface AddAppointmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clients: Client[];
  services: Service[];
  staff: Staff[];
  appointments: Appointment[];
  events: Event[];
  scheduleProfiles: any[];
  onConfirm: (apt: Omit<Appointment, 'id'>) => void;
  initialClientId?: string;
  appointmentToRebook?: Appointment | null;
}

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

const AddAppointmentForm = ({ 
    clients, 
    services,
    staff,
    appointments,
    events,
    scheduleProfiles,
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
    
    const publicScheduleProfile = useMemo(() => scheduleProfiles?.find(p => p.isActive), [scheduleProfiles]);
    const weekStart = useMemo(() => startOfWeek(date, { weekStartsOn: 0 }), [date]);
    const weekDays = useMemo(() => eachDayOfInterval({ start: weekStart, end: addDays(weekStart, 6) }), [weekStart]);

    const timeSlots = useMemo(() => {
        if (!selectedService || !date || !publicScheduleProfile) return [];

        const bookingInterval = publicScheduleProfile.bookingSlotInterval || 15;
        const dayName = format(date, 'eeee').toLowerCase();
        
        const selectedStaffMember = staff.find(s => s.id === selectedStaffId);
        let workingHours: { enabled: boolean; start: string; end: string; };

        const staffDaySchedule = selectedStaffMember?.availability?.week?.[dayName as keyof typeof selectedStaffMember.availability.week];

        if (staffDaySchedule && staffDaySchedule.enabled) {
            workingHours = staffDaySchedule;
        } else if (!staffDaySchedule && publicScheduleProfile?.week?.[dayName]) {
            workingHours = publicScheduleProfile.week[dayName];
        } else {
            return []; // Staff is explicitly not available or no schedule found
        }
        
        if (!workingHours || !workingHours.enabled) {
          return [];
        }
        
        const dayStartWithBusinessHours = timeStringToDate(workingHours.start, date);
        const dayEndWithBusinessHours = timeStringToDate(workingHours.end, date);
        
        const busyIntervals: { start: Date, end: Date }[] = [];

        appointments
          .filter(apt => {
            if (!isSameDay(apt.startTime, date)) return false;
            // When 'any' staff is selected, consider all appointments.
            // When a specific staff is selected, only consider their appointments.
            if (selectedStaffId !== 'any' && apt.staffId !== selectedStaffId) return false;
            return true;
          })
          .forEach(apt => {
            const service = services.find(s => s.id === apt.serviceId);
            const padBefore = service?.padBefore || 0;
            const padAfter = service?.padAfter || 0;
            busyIntervals.push({
              start: addMinutes(apt.startTime, -padBefore),
              end: addMinutes(apt.endTime, padAfter),
            });
          });

        events
          .filter(evt => {
            if (!isSameDay(evt.startTime, date)) return false;
            if (evt.type !== 'blocked') return false;
            // Block if event is for 'all' or for the specific staff member
            return !evt.staffId || evt.staffId === 'all' || (selectedStaffId !== 'any' && evt.staffId === selectedStaffId);
          })
          .forEach(evt => {
            busyIntervals.push({ start: evt.startTime, end: evt.endTime });
          });

        const options: string[] = [];
        
        let earliestBookableTime = dayStartWithBusinessHours;
        const now = new Date();

        if (isToday(date) && now > dayStartWithBusinessHours) {
            const minutesSinceStartOfDay = (now.getHours() * 60) + now.getMinutes();
            const businessStartMinutes = (earliestBookableTime.getHours() * 60) + earliestBookableTime.getMinutes();
            const intervalsToSkip = Math.ceil((minutesSinceStartOfDay - businessStartMinutes) / bookingInterval);
            if (intervalsToSkip > 0) {
                earliestBookableTime = addMinutes(dayStartWithBusinessHours, intervalsToSkip * bookingInterval);
            }
        }
        
        let currentTime = earliestBookableTime;

        while (currentTime < dayEndWithBusinessHours) {
            const potentialStartTime = currentTime;
            const totalDuration = selectedService.duration + (selectedService.padBefore || 0) + (selectedService.padAfter || 0);
            const potentialEndTime = addMinutes(potentialStartTime, totalDuration);
            
            if (potentialEndTime > dayEndWithBusinessHours) {
                break;
            }
            
            const isOverlapping = busyIntervals.some((interval) =>
                areIntervalsOverlapping(
                    { start: potentialStartTime, end: potentialEndTime },
                    interval,
                    { inclusive: false }
                )
            );

            if (!isOverlapping) {
                options.push(format(potentialStartTime, 'HH:mm'));
            }

            currentTime = addMinutes(currentTime, bookingInterval);
        }
        return options;
    }, [date, selectedStaffId, selectedService, staff, appointments, events, publicScheduleProfile, services]);

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
        
        const allServices = [selectedService, ...selectedAddOns];
        const allRequiredResourceIds = [...new Set(allServices.flatMap(s => s.requiredResourceIds || []))];

        const newAppointment: Omit<Appointment, 'id'> = {
            clientId: selectedClientId,
            serviceId: selectedServiceId,
            staffId: selectedStaffId,
            startTime: startDateTime,
            endTime: endDateTime,
            status: 'confirmed',
            addOnIds: selectedAddOns.map(s => s.id),
            checkInToken: nanoid(16),
            requiredResourceIds: allRequiredResourceIds,
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
                                         {selectedClient ? (
                                            <div className="flex items-center gap-2">
                                                <Avatar className="w-6 h-6">
                                                    <AvatarImage src={selectedClient.avatarUrl} />
                                                    <AvatarFallback>{selectedClient.name.charAt(0)}</AvatarFallback>
                                                </Avatar>
                                                <span>{selectedClient.name}</span>
                                            </div>
                                        ) : (
                                            <SelectValue placeholder="Select an existing client" />
                                        )}
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
                                    {selectedStaff ? (
                                        <div className="flex items-center gap-2">
                                            <Avatar className="w-6 h-6">
                                                <AvatarImage src={selectedStaff.avatarUrl} />
                                                <AvatarFallback>{selectedStaff.name.charAt(0)}</AvatarFallback>
                                            </Avatar>
                                            <span>{selectedStaff.name}</span>
                                        </div>
                                    ) : (
                                        <SelectValue placeholder="Select a staff member" />
                                    )}
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
                         <div className="rounded-lg border space-y-4 p-4">
                            <div className="flex items-center justify-between">
                                <Button variant="outline" size="icon" onClick={() => setDate(prev => subWeeks(prev, 1))} type="button"><ChevronLeft className="w-4 h-4" /></Button>
                                <span className="font-semibold text-center">
                                    {format(date, 'MMMM yyyy')}
                                </span>
                                <Button variant="outline" size="icon" onClick={() => setDate(prev => addWeeks(prev, 1))} type="button"><ChevronRight className="w-4 h-4" /></Button>
                            </div>
                            <div className="grid grid-cols-7 gap-2">
                                {weekDays.map(day => (
                                    <button
                                        key={day.toISOString()}
                                        onClick={() => setDate(day)}
                                        disabled={isBefore(day, startOfDay(new Date())) && !isSameDay(day, startOfDay(new Date()))}
                                        className={cn(
                                            "flex flex-col items-center justify-center p-2 rounded-lg border w-full aspect-square transition-colors",
                                            isSameDay(day, date)
                                                ? "bg-primary text-primary-foreground border-primary"
                                                : "bg-background hover:bg-accent",
                                            (isBefore(day, startOfDay(new Date())) && !isSameDay(day, startOfDay(new Date()))) && "opacity-50 cursor-not-allowed"
                                        )}
                                        type="button"
                                    >
                                        <span className="text-xs">{format(day, 'E')}</span>
                                        <span className="font-bold text-lg">{format(day, 'd')}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>Start Time</Label>
                             <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                                {timeSlots.map(time => (
                                    <Button
                                        key={time}
                                        variant={startTime === time ? 'default' : 'outline'}
                                        onClick={() => setStartTime(time)}
                                        type="button"
                                    >
                                        {format(setMinutes(setHours(new Date(), parseInt(time.split(':')[0])), parseInt(time.split(':')[1])), 'h:mm a')}
                                    </Button>
                                ))}
                                {timeSlots.length === 0 && (
                                    <div className="col-span-full text-center text-sm text-muted-foreground py-4">
                                        No available slots for this day.
                                    </div>
                                )}
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
                allAddOns={services.filter(s => s.type === 'addon')}
                initialSelected={selectedAddOns}
                onSelect={setSelectedAddOns}
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

export const AddAppointmentDialog: React.FC<AddAppointmentDialogProps> = ({ open, onOpenChange, clients, services, staff, appointments, events, scheduleProfiles, onConfirm, initialClientId, appointmentToRebook }) => {
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
    events={events}
    scheduleProfiles={scheduleProfiles}
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
