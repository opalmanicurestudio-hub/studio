
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
import { Client, Service, Appointment, Staff, Event, Resource } from '@/lib/data';
import { format, setHours, setMinutes, startOfDay, areIntervalsOverlapping, addMinutes, startOfWeek, subWeeks, addWeeks, eachDayOfInterval, isSameDay, isBefore, getDay, parse, isToday, addDays, addMonths, endOfDay, parseISO } from 'date-fns';
import { SelectAddOnsDialog } from '../services/SelectAddOnsDialog';
import { Card, CardContent } from '../ui/card';
import { nanoid } from 'nanoid';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Calendar } from '../ui/calendar';
import { useForm, Controller } from 'react-hook-form';
import { Switch } from '../ui/switch';
import { useToast } from '@/hooks/use-toast';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { collection, query, where } from 'firebase/firestore';


interface AddAppointmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (apt: Omit<Appointment, 'id' | 'startTime' | 'endTime'> & {startTime: Date, endTime: Date, recurrence?: { frequency: string, endDate: Date }}) => void;
  initialClientId?: string;
  appointmentToRebook?: Appointment | null;
  initialStartTime?: Date;
  initialStaffId?: string;
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
    onConfirm,
    initialClientId,
    appointmentToRebook,
    initialStartTime,
    initialStaffId
}: Omit<AddAppointmentDialogProps, 'open' | 'onOpenChange'> & { initialStartTime?: Date, initialStaffId?: string }) => {
    const { firestore } = useFirebase();
    const { selectedTenant } = useTenant();
    const tenantId = selectedTenant?.id;
    
    const { data: clients, isLoading: clientsLoading } = useCollection<Client>(useMemoFirebase(() => tenantId ? collection(firestore, `tenants/${tenantId}/clients`) : null, [firestore, tenantId]));
    const { data: services, isLoading: servicesLoading } = useCollection<Service>(useMemoFirebase(() => tenantId ? collection(firestore, `tenants/${tenantId}/services`) : null, [firestore, tenantId]));
    const { data: staff, isLoading: staffLoading } = useCollection<Staff>(useMemoFirebase(() => tenantId ? collection(firestore, `tenants/${tenantId}/staff`) : null, [firestore, tenantId]));

    const { data: scheduleProfiles, isLoading: scheduleProfilesLoading } = useCollection<any>(
        useMemoFirebase(() => tenantId ? query(collection(firestore, `tenants/${tenantId}/scheduleProfiles`), where("isActive", "==", true)) : null, [firestore, tenantId])
    );
    const { data: appointmentsFromDB, isLoading: appointmentsLoading } = useCollection<Appointment>(
        useMemoFirebase(() => tenantId ? collection(firestore, `tenants/${tenantId}/appointments`) : null, [firestore, tenantId])
    );
    const { data: eventsFromDB, isLoading: eventsLoading } = useCollection<Event>(
        useMemoFirebase(() => tenantId ? collection(firestore, `tenants/${tenantId}/events`) : null, [firestore, tenantId])
    );
    
    const appointments = useMemo(() => {
        if (!appointmentsFromDB) return [];
        return appointmentsFromDB.map(apt => ({
          ...apt,
          startTime: (apt.startTime as any)?.toDate ? (apt.startTime as any).toDate() : new Date(apt.startTime),
          endTime: (apt.endTime as any)?.toDate ? (apt.endTime as any).toDate() : new Date(apt.endTime),
        }));
      }, [appointmentsFromDB]);
    
      const events = useMemo(() => {
        if (!eventsFromDB) return [];
        return eventsFromDB.map(evt => ({
            ...evt,
            startTime: (evt.startTime as any)?.toDate ? (evt.startTime as any).toDate() : new Date(evt.startTime),
            endTime: (evt.endTime as any)?.toDate ? (evt.endTime as any).toDate() : new Date(evt.endTime),
        }));
      }, [eventsFromDB]);

    const { register, handleSubmit, control, watch, formState: { errors }, setValue, reset } = useForm({
        defaultValues: {
            clientId: initialClientId || '',
            serviceId: '',
            staffId: initialStaffId || '',
            date: new Date(),
            startTime: '',
            addOnIds: [],
            isRecurring: false,
            recurrence: {
                frequency: 'weekly',
                endDate: addMonths(new Date(), 3),
            }
        }
    });

    useEffect(() => {
        if (staff && !staffLoading) {
            const defaultValues = {
                clientId: appointmentToRebook ? appointmentToRebook.clientId : initialClientId || '',
                serviceId: appointmentToRebook ? appointmentToRebook.serviceId : '',
                staffId: appointmentToRebook ? (appointmentToRebook.staffId || staff[0]?.id || '') : (initialStaffId || staff[0]?.id || ''),
                date: appointmentToRebook ? new Date(appointmentToRebook.startTime) : (initialStartTime || new Date()),
                startTime: appointmentToRebook ? format(new Date(appointmentToRebook.startTime), 'HH:mm') : (initialStartTime ? format(initialStartTime, 'HH:mm') : ''),
                addOnIds: appointmentToRebook ? (appointmentToRebook.addOnIds || []) : [],
                isRecurring: false,
                recurrence: {
                    frequency: 'weekly',
                    endDate: addMonths(new Date(), 3),
                }
            };
            reset(defaultValues);
        }
    }, [staff, staffLoading, appointmentToRebook, initialClientId, initialStartTime, initialStaffId, reset]);

    const [isAddOnSelectorOpen, setIsAddOnSelectorOpen] = useState(false);
    const [isOverlapping, setIsOverlapping] = useState(false);
    const [showConfirmation, setShowConfirmation] = useState(false);

    const clientId = watch('clientId');
    const serviceId = watch('serviceId');
    const staffId = watch('staffId');
    const date = watch('date');
    const startTime = watch('startTime');
    const addOnIds = watch('addOnIds');
    
    const selectedService = useMemo(() => services?.find(s => s.id === serviceId), [services, serviceId]);
    const selectedClient = useMemo(() => clients?.find(c => c.id === clientId), [clients, clientId]);
    const selectedStaff = useMemo(() => staff?.find(s => s.id === staffId), [staff, staffId]);
    const selectedAddOns = useMemo(() => services?.filter(s => addOnIds.includes(s.id)), [services, addOnIds]);
    
    const handleAddOnsChange = (newAddOns: Service[]) => {
        setValue('addOnIds', newAddOns.map(s => s.id));
    };

    const removeAddOn = (addOnId: string) => {
        setValue('addOnIds', addOnIds.filter(id => id !== addOnId));
    };

    const publicScheduleProfile = useMemo(() => scheduleProfiles?.[0], [scheduleProfiles]);
    const weekStart = useMemo(() => startOfWeek(date, { weekStartsOn: 0 }), [date]);
    const weekDays = useMemo(() => eachDayOfInterval({ start: weekStart, end: addDays(weekStart, 6) }), [weekStart]);

    const timeSlots = useMemo(() => {
        if (!selectedService || !date || !publicScheduleProfile || !staff || !services) return [];

        const bookingInterval = publicScheduleProfile.bookingSlotInterval || 15;
        const dayName = format(date, 'eeee').toLowerCase();
        
        const selectedStaffMember = staff.find(s => s.id === staffId);
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

        (appointments || [])
          .filter(apt => {
            if (!isSameDay(apt.startTime, date)) return false;
            if (appointmentToRebook && apt.id === appointmentToRebook.id) return false;
            if (staffId !== 'any' && apt.staffId !== staffId) return false;
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

        (events || [])
          .filter(evt => {
            if (!isSameDay(evt.startTime, date)) return false;
            if (evt.type !== 'blocked') return false;
            return !evt.staffId || evt.staffId === 'all' || (staffId !== 'any' && evt.staffId === staffId);
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
    }, [date, staffId, selectedService, staff, appointments, events, publicScheduleProfile, services, appointmentToRebook]);

    useEffect(() => {
        if (!selectedService || !date || !startTime || !services || !appointments) {
            setIsOverlapping(false);
            return;
        }

        const [hours, minutes] = startTime.split(':').map(Number);
        const startDateTime = setMinutes(setHours(startOfDay(date), hours), minutes);
        
        const totalDuration = selectedService.duration + (selectedService.padBefore || 0) + (selectedService.padAfter || 0);
        const endDateTime = addMinutes(startDateTime, totalDuration);

        const newInterval = { start: startDateTime, end: endDateTime };

        const hasOverlap = appointments.some(apt => {
            if (appointmentToRebook && apt.id === appointmentToRebook.id) return false;
            const service = services.find(s => s.id === apt.serviceId);
            const padBefore = service?.padBefore || 0;
            const padAfter = service?.padAfter || 0;
            return areIntervalsOverlapping(newInterval, { 
                start: addMinutes(apt.startTime, -padBefore), 
                end: addMinutes(apt.endTime, padAfter) 
            }, { inclusive: false });
        });

        setIsOverlapping(hasOverlap);
    }, [date, startTime, selectedService, appointments, services, appointmentToRebook]);

    const confirmAndSubmit = (data: any) => {
        if (!data.clientId || !data.serviceId || !data.date || !data.startTime || !services) return;

        const [hours, minutes] = data.startTime.split(':').map(Number);
        const startDateTime = setMinutes(setHours(startOfDay(data.date), hours), minutes);
        const service = services.find(s => s.id === data.serviceId);
        const endDateTime = addMinutes(startDateTime, service?.duration || 0);
        
        const allServices = [service, ...selectedAddOns].filter((s): s is Service => !!s);
        const allRequiredResourceIds = [...new Set(allServices.flatMap(s => s.requiredResourceIds || []))];

        const newAppointment = {
            clientId: data.clientId,
            serviceId: data.serviceId,
            staffId: data.staffId,
            startTime: startDateTime,
            endTime: endDateTime,
            status: 'confirmed' as const,
            addOnIds: data.addOnIds || [],
            recurrence: data.isRecurring ? data.recurrence : undefined,
            requiredResourceIds: allRequiredResourceIds,
        };
        onConfirm(newAppointment);
    }
    
    const handleSaveAttempt = (data: any) => {
        if (!data.clientId || !data.serviceId || !data.startTime) {
            return;
        }
        if (isOverlapping) {
            setShowConfirmation(true);
        } else {
            confirmAndSubmit(data);
        }
    };
    
    return (
        <>
            <form id="add-appointment-form" onSubmit={handleSubmit(handleSaveAttempt)}>
                <div className="space-y-6">
                    <div className="space-y-4">
                        <h3 className="text-lg font-medium">Client & Service</h3>
                        <div className="space-y-2">
                            <Label htmlFor="client">Client</Label>
                            <div className="flex gap-2">
                                <Controller
                                    name="clientId"
                                    control={control}
                                    render={({ field }) => (
                                        <Select onValueChange={field.onChange} value={field.value}>
                                            <SelectTrigger id="client">
                                                {selectedClient ? (
                                                    <div className="flex items-center gap-2">
                                                        <Avatar className="w-6 h-6"><AvatarImage src={selectedClient.avatarUrl} /><AvatarFallback>{selectedClient.name.charAt(0)}</AvatarFallback></Avatar>
                                                        <span>{selectedClient.name}</span>
                                                    </div>
                                                ) : (
                                                    <SelectValue placeholder="Select a client" />
                                                )}
                                            </SelectTrigger>
                                            <SelectContent>
                                                {(clients || []).map(c => <SelectItem key={c.id} value={c.id}><div className="flex items-center gap-2"><Avatar className="w-6 h-6"><AvatarImage src={c.avatarUrl} /><AvatarFallback>{c.name.charAt(0)}</AvatarFallback></Avatar><span>{c.name}</span></div></SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    )}
                                />
                                <Button variant="outline" size="icon"><PlusCircle className="h-4 w-4" /></Button>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="staff">Staff Member</Label>
                            <Controller
                                name="staffId"
                                control={control}
                                render={({ field }) => (
                                    <Select onValueChange={field.onChange} value={field.value}>
                                        <SelectTrigger id="staff">
                                            {selectedStaff ? (<div className="flex items-center gap-2"><Avatar className="w-6 h-6"><AvatarImage src={selectedStaff.avatarUrl} /><AvatarFallback>{selectedStaff.name.charAt(0)}</AvatarFallback></Avatar><span>{selectedStaff.name}</span></div>) : (<SelectValue placeholder="Select a staff member" />)}
                                        </SelectTrigger>
                                        <SelectContent>
                                            {(staff || []).map(s => <SelectItem key={s.id} value={s.id}><div className="flex items-center gap-2"><Avatar className="w-6 h-6"><AvatarImage src={s.avatarUrl} /><AvatarFallback>{s.name.charAt(0)}</AvatarFallback></Avatar><span>{s.name}</span></div></SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                )}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="service">Service</Label>
                            <Controller
                                name="serviceId"
                                control={control}
                                render={({ field }) => (
                                    <Select onValueChange={field.onChange} value={field.value}>
                                        <SelectTrigger id="service"><SelectValue placeholder="Select a service" /></SelectTrigger>
                                        <SelectContent>{(services || []).filter(s => s.type === 'service').map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                                    </Select>
                                )}
                            />
                        </div>
                    </div>

                    <div className="space-y-4">
                        <h3 className="text-lg font-medium">Add-on Services</h3>
                        {selectedAddOns.length > 0 ? (
                            <Card><CardContent className="p-2 space-y-2">{selectedAddOns.map(item => (<div key={item.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50"><span className="text-sm font-medium">{item.name}</span><Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeAddOn(item.id)}><Trash2 className="h-4 w-4" /></Button></div>))}</CardContent></Card>
                        ) : (<Card><CardContent className="p-4 text-center text-sm text-muted-foreground">No add-ons selected.</CardContent></Card>)}
                        <Button variant="outline" onClick={() => setIsAddOnSelectorOpen(true)} type="button"><PlusCircle className="mr-2 h-4 w-4" /> Select Add-ons</Button>
                    </div>

                    <div className="space-y-4">
                        <h3 className="text-lg font-medium">Date & Time</h3>
                        <div className="rounded-lg border space-y-4 p-4">
                            <div className="flex items-center justify-between">
                                <Button variant="outline" size="icon" onClick={() => setValue('date', subWeeks(date, 1))} type="button"><ChevronLeft className="w-4 h-4" /></Button>
                                <span className="font-semibold text-center">{format(weekStart, 'MMMM yyyy')}</span>
                                <Button variant="outline" size="icon" onClick={() => setValue('date', addWeeks(date, 1))} type="button"><ChevronRight className="w-4 h-4" /></Button>
                            </div>
                            <div className="grid grid-cols-7 gap-2">{weekDays.map(day => (<button key={day.toISOString()} onClick={() => setValue('date', day)} disabled={isBefore(day, startOfDay(new Date())) && !isSameDay(day, startOfDay(new Date()))} className={cn("flex flex-col items-center justify-center p-2 rounded-lg border w-full aspect-square transition-colors", isSameDay(day, date) ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent", (isBefore(day, startOfDay(new Date())) && !isSameDay(day, startOfDay(new Date()))) && "opacity-50 cursor-not-allowed")} type="button"><span className="text-xs">{format(day, 'E')}</span><span className="font-bold text-lg">{format(day, 'd')}</span></button>))}</div>
                        </div>
                        <div className="space-y-2">
                            <Label>Start Time</Label>
                            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                                {timeSlots.map(time => (<Button key={time} variant={startTime === time ? 'default' : 'outline'} onClick={() => setValue('startTime', time)} type="button">{format(setMinutes(setHours(new Date(), parseInt(time.split(':')[0])), parseInt(time.split(':')[1])), 'h:mm a')}</Button>))}
                                {timeSlots.length === 0 && (<div className="col-span-full text-center text-sm text-muted-foreground py-4">No available slots for this day.</div>)}
                            </div>
                        </div>
                        {isOverlapping && (<Alert variant="destructive" className="mt-2"><AlertTriangle className="h-4 w-4" /><AlertTitle>Potential Double Booking</AlertTitle><AlertDescription>This time slot overlaps with an existing appointment.</AlertDescription></Alert>)}
                    </div>
                     <div className="space-y-4">
                        <Controller
                            name="isRecurring"
                            control={control}
                            render={({ field }) => (
                                <div className="flex items-center justify-between p-4 border rounded-lg">
                                    <div className="space-y-0.5">
                                        <Label htmlFor="is-recurring" className="text-base">Recurring Appointment</Label>
                                        <p className="text-sm text-muted-foreground">Set up a repeating schedule for this client.</p>
                                    </div>
                                    <Switch id="is-recurring" checked={field.value} onCheckedChange={field.onChange} />
                                </div>
                            )}
                        />
                         {watch('isRecurring') && (
                            <Card className="bg-muted/50"><CardContent className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                                <Controller
                                    name="recurrence.frequency"
                                    control={control}
                                    render={({ field }) => (
                                        <div className="space-y-2">
                                            <Label>Frequency</Label>
                                            <Select onValueChange={field.onChange} value={field.value}>
                                                <SelectTrigger><SelectValue placeholder="Select frequency" /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="weekly">Weekly</SelectItem>
                                                    <SelectItem value="bi-weekly">Bi-Weekly</SelectItem>
                                                    <SelectItem value="every-3-weeks">Every 3 Weeks</SelectItem>
                                                    <SelectItem value="every-4-weeks">Every 4 Weeks</SelectItem>
                                                    <SelectItem value="monthly">Monthly</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    )}
                                />
                                <Controller
                                    name="recurrence.endDate"
                                    control={control}
                                    render={({ field }) => (
                                        <div className="space-y-2">
                                            <Label>End Date</Label>
                                            <Popover>
                                                <PopoverTrigger className={cn(buttonVariants({ variant: 'outline' }), 'w-full justify-start text-left font-normal', !field.value && 'text-muted-foreground')}>
                                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                                    {field.value ? format(field.value, 'PPP') : 'Pick end date'}
                                                </PopoverTrigger>
                                                <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus /></PopoverContent>
                                            </Popover>
                                        </div>
                                    )}
                                />
                            </CardContent></Card>
                         )}
                    </div>
                </div>
            </form>
            <SelectAddOnsDialog 
                open={isAddOnSelectorOpen} 
                onOpenChange={setIsAddOnSelectorOpen} 
                allAddOns={(services || []).filter(s => s.type === 'addon')} 
                initialSelected={selectedAddOns} 
                onSelect={handleAddOnsChange} 
            />
            <AlertDialog open={showConfirmation} onOpenChange={setShowConfirmation}>
                <AlertDialogContent>
                    <AlertDialogHeader><AlertDialogTitle>Confirm Double Booking</AlertDialogTitle><AlertDialogDescription>This time slot overlaps with an existing appointment. Are you sure you want to proceed?</AlertDialogDescription></AlertDialogHeader>
                    <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleSubmit(confirmAndSubmit)}>Book Anyway</AlertDialogAction></AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}

export const AddAppointmentDialog: React.FC<AddAppointmentDialogProps> = ({ open, onOpenChange, onConfirm, initialClientId, appointmentToRebook, initialStartTime, initialStaffId }) => {
  const isMobile = useIsMobile();

  const formKey = useMemo(() => {
    return appointmentToRebook ? `rebook-${appointmentToRebook.id}` : `new-${initialClientId || initialStaffId ||'fresh'}`;
  }, [appointmentToRebook, initialClientId, initialStaffId]);

  const title = "New Appointment";
  const description = "Book a new appointment for a client.";
  
  const FormContent = <AddAppointmentForm 
    key={formKey}
    onConfirm={onConfirm} 
    initialClientId={initialClientId} 
    appointmentToRebook={appointmentToRebook}
    initialStartTime={initialStartTime}
    initialStaffId={initialStaffId}
    />;

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[95vh] flex flex-col p-0">
          <SheetHeader className="text-left p-4 border-b">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>
          <div className="py-4 flex-1 overflow-y-auto px-4">{FormContent}</div>
          <SheetFooter className="px-4 border-t">
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
