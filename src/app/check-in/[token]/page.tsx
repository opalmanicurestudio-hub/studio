

'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Clock, Car, MapPin, Check, AlertTriangle, X, CreditCard, Loader, CalendarIcon, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { format, parseISO, addMinutes, addHours, isBefore, startOfDay, setHours, setMinutes, eachDayOfInterval, startOfWeek, isSameDay, subWeeks, addWeeks, areIntervalsOverlapping, addDays, getDay } from 'date-fns';
import { ClarityFlowLogo } from '@/components/shared/AppSidebar';
import { type Appointment, type Client, type Service, type Event, type Tenant } from '@/lib/data';
import { type Transaction } from '@/lib/financial-data';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { useFirebase, useCollection, useMemoFirebase, updateDocumentNonBlocking, addDocumentNonBlocking, useDoc } from '@/firebase';
import { collection, query, where, doc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';

export default function CheckInPage() {
    const params = useParams();
    const router = useRouter();
    const token = params.token as string;
    const { toast } = useToast();

    const { firestore, isUserLoading } = useFirebase();
    const tenantId = 'tenant-abc';

    // Fetch appointment by token from the public collection
    const appointmentCheckInRef = useMemoFirebase(() => {
        if (!firestore || !token) return null;
        return doc(firestore, 'appointmentCheckIns', token);
    }, [firestore, token]);
    const { data: appointmentFromCheckIn, isLoading: appointmentsLoading } = useDoc<Appointment>(appointmentCheckInRef);

    const appointment = useMemo(() => {
        if (!appointmentFromCheckIn) return null;
        try {
            const startTime = (appointmentFromCheckIn.startTime as any)?.toDate ? (appointmentFromCheckIn.startTime as any).toDate() : parseISO(appointmentFromCheckIn.startTime as any);
            const endTime = (appointmentFromCheckIn.endTime as any)?.toDate ? (appointmentFromCheckIn.endTime as any).toDate() : parseISO(appointmentFromCheckIn.endTime as any);
            
            if (isNaN(startTime.getTime())) {
                console.error("Invalid startTime:", appointmentFromCheckIn.startTime);
                return null;
            }

            return { ...appointmentFromCheckIn, startTime, endTime };
        } catch (e) {
            console.error("Error parsing appointment dates", e);
            return null;
        }
    }, [appointmentFromCheckIn]);


    // Fetch all other necessary data
    const clientsQuery = useMemoFirebase(() => firestore ? collection(firestore, 'tenants', tenantId, 'clients') : null, [firestore, tenantId]);
    const servicesQuery = useMemoFirebase(() => firestore ? collection(firestore, 'tenants', tenantId, 'services') : null, [firestore, tenantId]);
    const allAppointmentsQuery = useMemoFirebase(() => firestore ? collection(firestore, 'tenants', tenantId, 'appointments') : null, [firestore, tenantId]);
    const eventsQuery = useMemoFirebase(() => firestore ? collection(firestore, 'tenants', tenantId, 'events') : null, [firestore, tenantId]);
    const scheduleProfilesQuery = useMemoFirebase(() => firestore ? collection(firestore, 'tenants', tenantId, 'scheduleProfiles') : null, [firestore, tenantId]);
    
    const tenantQuery = useMemoFirebase(() => {
        if (!firestore) return null;
        return doc(firestore, 'tenants', tenantId);
    }, [firestore, tenantId]);

    const { data: allAppointmentsFromDB, isLoading: allAppointmentsLoading } = useCollection<Appointment>(allAppointmentsQuery);
    const { data: clients, isLoading: clientsLoading } = useCollection<Client>(clientsQuery);
    const { data: services, isLoading: servicesLoading } = useCollection<Service>(servicesQuery);
    const { data: allEventsFromDB, isLoading: eventsLoading } = useCollection<Event>(eventsQuery);
    const { data: scheduleProfiles, isLoading: scheduleProfilesLoading } = useCollection<any>(scheduleProfilesQuery);
    
    const { data: tenantData, isLoading: tenantLoading } = useDoc<Tenant>(tenantQuery);
    
    const publicScheduleProfile = useMemo(() => scheduleProfiles?.find(p => p.isActive), [scheduleProfiles]);

    const allAppointments = useMemo(() => {
        if (!allAppointmentsFromDB) return [];
        return allAppointmentsFromDB.map(apt => ({
            ...apt,
            startTime: (apt.startTime as any)?.toDate ? (apt.startTime as any).toDate() : new Date(apt.startTime),
            endTime: (apt.endTime as any)?.toDate ? (apt.endTime as any).toDate() : new Date(apt.endTime),
        }));
    }, [allAppointmentsFromDB]);
    
    const allEvents = useMemo(() => {
        if (!allEventsFromDB) return [];
        return allEventsFromDB.map(evt => ({
            ...evt,
            startTime: (evt.startTime as any)?.toDate ? (evt.startTime as any).toDate() : new Date(evt.startTime),
            endTime: (evt.endTime as any)?.toDate ? (evt.endTime as any).toDate() : new Date(evt.endTime),
        }));
    }, [allEventsFromDB]);


    const data = useMemo(() => {
        if (!appointment || !clients || !services) return null;
        const client = clients.find(c => c.id === appointment.clientId);
        const service = services.find(s => s.id === appointment.serviceId);
        if (!client || !service) return null;
        return { appointment, client, service };
    }, [appointment, clients, services]);

    // UI State
    const [currentStatus, setCurrentStatus] = useState<Appointment['checkInStatus']>('pending');
    const [lateTime, setLateTime] = useState(0);
    const [showLateOptions, setShowLateOptions] = useState(false);
    const [isCancelled, setIsCancelled] = useState(false);
    const [rescheduleStep, setRescheduleStep] = useState<'initial' | 'payment' | 'reschedule' | 'confirmed'>('initial');
    
    const [rescheduleDate, setRescheduleDate] = useState<Date>(new Date());
    const [rescheduleTime, setRescheduleTime] = useState<string>('');
    
    const weekStart = useMemo(() => startOfWeek(rescheduleDate), [rescheduleDate]);
    const weekDays = useMemo(() => eachDayOfInterval({ start: weekStart, end: addDays(weekStart, 6) }), [weekStart]);

    const handlePreviousWeek = () => setRescheduleDate(prev => subWeeks(prev, 1));
    const handleNextWeek = () => setRescheduleDate(prev => addWeeks(prev, 1));
    const handleDateSelect = (day: Date) => setRescheduleDate(day);
    
    const timeSlots = useMemo(() => {
        if (!data?.service || !rescheduleDate || !allAppointments || !publicScheduleProfile || !allEvents) return [];

        const bookingInterval = publicScheduleProfile.bookingSlotInterval || 15;

        const dayOfWeekIndex = getDay(rescheduleDate);
        const dayName = format(rescheduleDate, 'eeee').toLowerCase();
        
        const businessDayHours = publicScheduleProfile.week[dayName];

        if (!businessDayHours || !businessDayHours.enabled) {
            return [];
        }

        const openTimeParts = businessDayHours.start.match(/(\d+):(\d+) (AM|PM)/);
        const closeTimeParts = businessDayHours.end.match(/(\d+):(\d+) (AM|PM)/);

        if (!openTimeParts || !closeTimeParts) return [];

        let openHour = parseInt(openTimeParts[1]);
        const openMinute = parseInt(openTimeParts[2]);
        if (openTimeParts[3] === 'PM' && openHour < 12) openHour += 12;
        if (openTimeParts[3] === 'AM' && openHour === 12) openHour = 0;
        
        let closeHour = parseInt(closeTimeParts[1]);
        const closeMinute = parseInt(closeTimeParts[2]);
        if (closeTimeParts[3] === 'PM' && closeHour < 12) closeHour += 12;
        if (closeTimeParts[3] === 'AM' && closeHour === 12) closeHour = 0;
        
        const dayStartWithBusinessHours = setMinutes(setHours(startOfDay(rescheduleDate), openHour), openMinute);
        const dayEndWithBusinessHours = setMinutes(setHours(startOfDay(rescheduleDate), closeHour), closeMinute);

        const options: string[] = [];
        
        const busyIntervals = [
            ...allAppointments
                .filter(apt => apt.id !== appointment?.id && isSameDay(apt.startTime, rescheduleDate))
                .map(apt => {
                    const service = services?.find(s => s.id === apt.serviceId);
                    const padBefore = service?.padBefore || 0;
                    const padAfter = service?.padAfter || 0;
                    return {
                        start: addMinutes(apt.startTime, -padBefore),
                        end: addMinutes(apt.endTime, padAfter)
                    }
                }),
            ...allEvents
                .filter(evt => isSameDay(evt.startTime, rescheduleDate) && evt.type === 'blocked')
                 .map(evt => ({
                    start: evt.startTime,
                    end: evt.endTime,
                }))
        ];

        for (let i = dayStartWithBusinessHours.getTime(); i < dayEndWithBusinessHours.getTime(); i += bookingInterval * 60000) {
            const potentialStartTime = new Date(i);
            
            const totalDuration = data.service.duration + (data.service.padBefore || 0) + (data.service.padAfter || 0);
            const potentialEndTime = addMinutes(potentialStartTime, totalDuration);

            if (potentialEndTime > dayEndWithBusinessHours) {
                continue;
            }

            const isOverlapping = busyIntervals.some(interval =>
                areIntervalsOverlapping(
                    { start: potentialStartTime, end: potentialEndTime },
                    interval,
                    { inclusive: false }
                )
            );

            if (!isOverlapping) {
                options.push(format(potentialStartTime, 'HH:mm'));
            }
        }
        return options;
    }, [rescheduleDate, data?.service, allAppointments, services, appointment?.id, publicScheduleProfile, allEvents]);



    useEffect(() => {
        if (data?.appointment?.checkInStatus) {
            setCurrentStatus(data.appointment.checkInStatus);
            if (data.appointment.checkInStatus === 'running_late') {
                setLateTime(data.appointment.lateTimeMinutes || 0);
            }
        }
    }, [data]);

    const handleUpdateStatus = (newStatus: Appointment['checkInStatus'], lateMinutes?: number) => {
        if (!appointment || !firestore) return;
        
        const updateData: Partial<Appointment> = { checkInStatus: newStatus };
        if (lateMinutes !== undefined) {
            updateData.lateTimeMinutes = lateMinutes;
        }

        // Update the public document
        const appointmentCheckInRef = doc(firestore, 'appointmentCheckIns', token);
        updateDocumentNonBlocking(appointmentCheckInRef, updateData);

        // Update the private document
        const originalAppointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', appointment.id);
        updateDocumentNonBlocking(originalAppointmentRef, updateData);

        setCurrentStatus(newStatus);
    };

    const handleConfirmLate = () => {
        const gracePeriod = 15; // This should come from tenant settings
        const autoCancelEnabled = true; // This should come from tenant settings

        if (autoCancelEnabled && lateTime > gracePeriod) {
            setIsCancelled(true);
            setRescheduleStep('initial');
        } else {
            handleUpdateStatus('running_late', lateTime);
        }
        setShowLateOptions(false);
    };

    const handlePayFee = () => {
        if (!appointment || !data?.client || !firestore) return;
        
        const newTransaction: Omit<Transaction, 'id'> = {
            date: new Date().toISOString(),
            description: `Late cancellation fee for appointment #${appointment.id.slice(-6)}`,
            clientOrVendor: data.client.name,
            type: 'income',
            context: 'Business',
            category: 'Cancellation Fee',
            amount: 25.00, // This should come from tenant settings
            paymentMethod: 'Card Online',
            hasReceipt: false,
        };
        const transactionsRef = collection(firestore, 'tenants', 'tenant-abc', 'transactions');
        addDocumentNonBlocking(transactionsRef, newTransaction);
        
        toast({
            title: 'Payment Successful!',
            description: 'Your cancellation fee has been paid.',
        });
        setRescheduleStep('reschedule');
    };

    const handleReschedule = async () => {
        if (!appointment || !firestore || !data?.service || !rescheduleDate || !rescheduleTime) return;

        const [hours, minutes] = rescheduleTime.split(':').map(Number);
        const newStartTime = setMinutes(setHours(startOfDay(rescheduleDate), hours), minutes);

        const newEndTime = addMinutes(newStartTime, data.service.duration);
        
        const updateData = {
            startTime: newStartTime.toISOString(),
            endTime: newEndTime.toISOString(),
            status: 'confirmed' as const,
            checkInStatus: 'pending' as const,
            lateTimeMinutes: 0,
            automatedRescheduleOffered: true,
        };

        const appointmentCheckInRef = doc(firestore, 'appointmentCheckIns', token);
        await updateDocumentNonBlocking(appointmentCheckInRef, updateData);
        
        const originalAppointmentRef = doc(firestore, 'tenants', 'tenant-abc', 'appointments', appointment.id);
        await updateDocumentNonBlocking(originalAppointmentRef, updateData);

        setRescheduleStep('confirmed');
    };

    const renderCancellationFlow = () => {
        switch (rescheduleStep) {
            case 'initial':
                return (
                    <div className="p-4 bg-destructive/10 text-destructive text-center rounded-lg space-y-4">
                        <AlertTriangle className="w-8 h-8 mx-auto"/>
                        <h3 className="font-bold">Appointment Cancelled</h3>
                        <p className="text-xs">
                            Your appointment has been automatically cancelled as your arrival time is outside the 15-minute grace period.
                        </p>
                        <div className="pt-4 border-t border-destructive/20">
                                <p className="text-sm">A cancellation fee of <strong>$25.00</strong> is required to rebook.</p>
                                <Button className="mt-4 w-full bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => setRescheduleStep('payment')}>
                                Pay Fee &amp; Reschedule
                                </Button>
                        </div>
                    </div>
                );
            case 'payment':
                 return (
                     <div className="p-4 bg-muted/50 text-center rounded-lg space-y-4">
                        <CreditCard className="w-8 h-8 mx-auto text-primary"/>
                        <h3 className="font-bold">Pay Cancellation Fee</h3>
                        <p className="text-xs text-muted-foreground">
                           Please confirm to pay the $25.00 cancellation fee with your card on file.
                        </p>
                        <div className="pt-4">
                             <Button className="mt-4 w-full" onClick={handlePayFee}>
                                Pay $25.00 Now
                             </Button>
                             <Button variant="link" size="sm" className="mt-2" onClick={() => setRescheduleStep('initial')}>Cancel</Button>
                        </div>
                    </div>
                );
            case 'reschedule':
                 const isDayClosed = (day: Date) => {
                    if (!publicScheduleProfile) return true; // Assume closed if no profile
                    const dayName = format(day, 'eeee').toLowerCase();
                    const dayHours = publicScheduleProfile.week[dayName];
                    return !dayHours || !dayHours.enabled;
                }
                return (
                    <Card className="bg-muted/50 p-4 space-y-6">
                        <div className="text-center">
                            <Check className="w-8 h-8 mx-auto text-green-500 mb-2"/>
                            <h3 className="font-bold text-lg">Payment Successful!</h3>
                            <p className="text-sm text-muted-foreground">Select a new date and time for your appointment.</p>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <div className="flex justify-between items-center mb-2">
                                    <h3 className="font-semibold text-foreground">Select Date</h3>
                                    <div className="flex items-center gap-1 text-sm">
                                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handlePreviousWeek}><ChevronLeft className="w-4 h-4"/></Button>
                                        <span className="font-medium">{format(rescheduleDate, 'MMMM yyyy')}</span>
                                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleNextWeek}><ChevronRight className="w-4 h-4"/></Button>
                                    </div>
                                </div>
                                <div className="grid grid-cols-7 gap-2">
                                    {weekDays.map(day => (
                                        <button
                                            key={day.toISOString()}
                                            onClick={() => handleDateSelect(day)}
                                            disabled={isDayClosed(day)}
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
                            
                            <div>
                                <div className="flex justify-between items-center mb-2">
                                    <h3 className="font-semibold text-foreground">Select Time</h3>
                                    <span className="text-sm text-muted-foreground">{timeSlots.length} Slots</span>
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                    {timeSlots.map(slot => (
                                        <Button 
                                            key={slot} 
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
                        <Button onClick={handleReschedule} disabled={!rescheduleTime} className="w-full">
                            Book an Appointment
                        </Button>
                        <Button variant="link" size="sm" className="mt-2 w-full" onClick={() => { setIsCancelled(false); handleUpdateStatus('cancelled'); }}>
                            No, Thanks. Cancel appointment.
                        </Button>
                    </Card>
                );
            case 'confirmed':
                 return (
                     <div className="p-4 bg-green-500/10 text-green-700 dark:text-green-300 rounded-lg text-center">
                        <p className="font-semibold">You're all set!</p>
                        <p className="text-sm">Your appointment has been rescheduled. We'll see you soon!</p>
                    </div>
                );
        }
    }


    const isLoading = isUserLoading || appointmentsLoading || clientsLoading || servicesLoading || allAppointmentsLoading || scheduleProfilesLoading || eventsLoading || tenantLoading;

    if (isLoading) {
        return (
            <div className="flex flex-col items-center gap-4">
                <Loader className="h-8 w-8 animate-spin" />
                <p className="text-muted-foreground">Loading your appointment...</p>
            </div>
        );
    }

    if (!data) {
        return (
            <Card className="w-full max-w-md">
                <CardHeader className="text-center"><CardTitle>Appointment Not Found</CardTitle></CardHeader>
                <CardContent><p className="text-center text-muted-foreground">We couldn't find an appointment associated with this link. It may have expired or been cancelled.</p></CardContent>
                <CardFooter><Button className="w-full" onClick={() => router.push('/')}>Go to Homepage</Button></CardFooter>
            </Card>
        );
    }
    
    const { appointment: appointmentWithDate, client, service } = data;

    return (
        <Card className="w-full max-w-md">
            <CardHeader className="text-center">
                <div className="flex justify-center mb-4"><ClarityFlowLogo /></div>
                <CardTitle>Hello, {client.name.split(' ')[0]}!</CardTitle>
                <CardDescription>Ready for your appointment?</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="p-4 rounded-lg bg-muted/50 border space-y-3">
                     <div className="flex items-center gap-3">
                        <Avatar>
                            <AvatarImage src={client.avatarUrl} />
                            <AvatarFallback>{client.name.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <div>
                             <p className="font-semibold">{service.name}</p>
                             <p className="text-sm text-muted-foreground">{format(appointmentWithDate.startTime, 'EEEE, MMMM d')} at {format(appointmentWithDate.startTime, 'h:mm a')}</p>
                        </div>
                    </div>
                    <div className="text-sm text-muted-foreground space-y-2 pt-3 border-t">
                        <div className="flex items-center gap-2"><Clock className="w-4 h-4"/> Duration: {service.duration} minutes</div>
                        <div className="flex items-center gap-2"><MapPin className="w-4 h-4"/> ClarityFlow Salon</div>
                    </div>
                </div>
                
                {isCancelled ? renderCancellationFlow() : showLateOptions ? (
                    <div className="space-y-4">
                         <h4 className="font-medium text-center">How late will you be?</h4>
                        <RadioGroup 
                            value={lateTime > 0 ? String(lateTime) : undefined}
                            onValueChange={(val) => setLateTime(parseInt(val))} 
                            className="grid grid-cols-4 gap-2"
                        >
                            <div>
                                <RadioGroupItem value="5" id="late-5" className="peer sr-only" />
                                <Label htmlFor="late-5" className="p-3 border rounded-md text-center cursor-pointer peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/10">5 min</Label>
                            </div>
                            <div>
                                <RadioGroupItem value="10" id="late-10" className="peer sr-only" />
                                <Label htmlFor="late-10" className="p-3 border rounded-md text-center cursor-pointer peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/10">10 min</Label>
                            </div>
                            <div>
                                <RadioGroupItem value="15" id="late-15" className="peer sr-only" />
                                <Label htmlFor="late-15" className="p-3 border rounded-md text-center cursor-pointer peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/10">15 min</Label>
                            </div>
                            <div>
                                <RadioGroupItem value="20" id="late-20" className="peer sr-only" />
                                <Label htmlFor="late-20" className="p-3 border rounded-md text-center cursor-pointer peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/10">20+</Label>
                            </div>
                        </RadioGroup>
                        
                        {lateTime >= 15 && (
                            <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-center">
                                <AlertTriangle className="w-6 h-6 mx-auto mb-2"/>
                                <p className="font-semibold">Please Be Aware</p>
                                <p className="text-xs">Arrivals more than 15 minutes late may need to be rescheduled. A fee of $25.00 may apply.</p>
                            </div>
                        )}

                        <div className="grid grid-cols-2 gap-4">
                            <Button variant="outline" onClick={() => {setShowLateOptions(false); setLateTime(0)}}>Cancel</Button>
                             <Button onClick={handleConfirmLate} disabled={lateTime === 0}>
                                {lateTime >= 15 ? 'I Understand' : 'Confirm'}
                             </Button>
                        </div>
                    </div>
                ) : currentStatus === 'pending' ? (
                    <div className="grid grid-cols-2 gap-4">
                        <Button size="lg" onClick={() => setShowLateOptions(true)} variant="outline">Running Late?</Button>
                        <Button size="lg" onClick={() => handleUpdateStatus('on_my_way')}>
                            <Car className="mr-2" /> On My Way
                        </Button>
                    </div>
                ) : currentStatus === 'on_my_way' ? (
                    <div className="space-y-4">
                        <div className="p-4 bg-green-500/10 text-green-700 dark:text-green-300 rounded-lg text-center"><p className="font-semibold">Great! We'll see you soon.</p></div>
                        <Button size="lg" className="w-full" onClick={() => handleUpdateStatus('arrived')}><Check className="mr-2" /> I've Arrived</Button>
                    </div>
                ) : currentStatus === 'arrived' ? (
                    <div className="p-4 bg-blue-500/10 text-blue-700 dark:text-blue-300 rounded-lg text-center">
                        <p className="font-semibold">You're checked in!</p>
                        <p className="text-sm">Please have a seat, we'll be with you shortly.</p>
                    </div>
                ) : currentStatus === 'running_late' ? (
                    <div className="p-4 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 rounded-lg text-center">
                        <p className="font-semibold">Thank you for letting us know!</p>
                        <p className="text-sm">We've noted you'll be about {lateTime} minutes late. See you soon.</p>
                    </div>
                ) : null}
            </CardContent>
        </Card>
    );
}
