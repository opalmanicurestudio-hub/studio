'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Clock, Car, MapPin, Check, AlertTriangle, X, CreditCard, Loader, CalendarIcon, ChevronDown, ChevronLeft, ChevronRight, QrCode, BookOpen, TicketIcon, User as UserIcon, Scissors } from 'lucide-react';
import { format, parseISO, addMinutes, addHours, isBefore, startOfDay, setHours, setMinutes, eachDayOfInterval, startOfWeek, isSameDay, subWeeks, addWeeks, areIntervalsOverlapping, addDays, getDay, parse } from 'date-fns';
import { ClarityFlowLogo } from '@/components/shared/AppSidebar';
import { type Appointment, type Client, type Service, type Event, type Tenant, type Staff } from '@/lib/data';
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
import Image from 'next/image';
import Link from 'next/link';

/**
 * Utility to safely convert Firestore/API values to Date objects.
 */
const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val?.toDate === 'function') return val.toDate();
    if (typeof val === 'string') return parseISO(val);
    return new Date(val);
};

const ServicingView = ({ serviceName }: { serviceName: string }) => (
    <Card className="w-full max-w-md">
        <CardHeader className="text-center">
             <div className="flex justify-center mb-4"><ClarityFlowLogo /></div>
            <CardTitle>Sit Back & Relax</CardTitle>
            <CardDescription>Your service is currently in progress.</CardDescription>
        </CardHeader>
        <CardContent className="text-center">
            <p>Your {serviceName} is underway. We'll let you know when it's time to check out!</p>
        </CardContent>
    </Card>
);

const CheckoutView = ({ qrCodeUrl, ticketId }: { qrCodeUrl: string, ticketId: string }) => (
    <Card className="w-full max-w-md">
        <CardHeader className="text-center">
             <div className="flex justify-center mb-4"><ClarityFlowLogo /></div>
            <CardTitle>Ready for Checkout</CardTitle>
            <CardDescription>Your service is complete! Please proceed to the front desk.</CardDescription>
        </CardHeader>
        <CardContent className="text-center flex flex-col items-center gap-4">
            <p>Scan this QR code at the register to quickly pull up your ticket and complete payment.</p>
            <div className="p-4 bg-white rounded-xl shadow-inner border">
                <Image src={qrCodeUrl} alt="Checkout QR Code" width={200} height={200} />
            </div>
            <div className="bg-muted p-3 rounded-lg w-full flex flex-col items-center gap-1">
                <p className="text-[10px] uppercase font-black tracking-widest text-muted-foreground flex items-center gap-1.5">
                    <TicketIcon className="w-3 h-3" />
                    Ticket ID
                </p>
                <p className="text-2xl font-mono font-bold tracking-tighter">{ticketId}</p>
                <p className="text-[10px] text-muted-foreground">Show this code if the scanner has trouble.</p>
            </div>
        </CardContent>
    </Card>
);

const ThankYouView = ({ tenantId }: { tenantId: string }) => (
    <Card className="w-full max-w-md">
        <CardHeader className="text-center">
             <div className="flex justify-center mb-4"><ClarityFlowLogo /></div>
            <CardTitle>Thank You!</CardTitle>
            <CardDescription>Your appointment is complete. We hope to see you again soon!</CardDescription>
        </CardHeader>
        <CardContent className="text-center">
            <p>Enjoyed your experience? We'd love for you to book your next appointment or leave us a review.</p>
        </CardContent>
         <CardFooter className="flex flex-col gap-2">
            <Button asChild className="w-full"><Link href={`/book/${tenantId}`}>Book Next Appointment</Link></Button>
            <Button variant="outline" className="w-full">Leave a Review</Button>
        </CardFooter>
    </Card>
);

const CancelledView = ({ tenantId }: { tenantId?: string }) => (
     <Card className="w-full max-w-md border-destructive/20">
        <CardHeader className="text-center">
             <div className="flex justify-center mb-4"><ClarityFlowLogo className="grayscale opacity-50" /></div>
            <CardTitle className="text-destructive text-2xl font-black">Appointment Cancelled</CardTitle>
        </CardHeader>
        <CardContent className="text-center space-y-4">
            <p className="text-muted-foreground">This appointment has been cancelled and is no longer on our schedule. If you believe this is an error, please contact us directly.</p>
        </CardContent>
         <CardFooter className="flex flex-col gap-3">
             {tenantId && (
                <Button asChild className="w-full h-12 text-lg font-bold">
                    <Link href={`/book/${tenantId}`}>Book a New Appointment</Link>
                </Button>
             )}
             <Button asChild variant="ghost" className="w-full text-muted-foreground">
                <Link href="/">Return to Homepage</Link>
            </Button>
        </CardFooter>
    </Card>
);

export default function CheckInPage() {
    const params = useParams();
    const router = useRouter();
    const token = params.token as string;
    const { toast } = useToast();

    const { firestore } = useFirebase();

    // Fetch appointment by token from the public collection
    const appointmentCheckInRef = useMemoFirebase(() => {
        if (!firestore || !token) return null;
        return doc(firestore, 'appointmentCheckIns', token);
    }, [firestore, token]);
    const { data: appointmentData, isLoading: appointmentLoading } = useDoc<Appointment>(appointmentCheckInRef);

    const tenantId = useMemo(() => appointmentData?.tenantId, [appointmentData]);

    // Fetch tenant using the dynamic tenantId
    const tenantDocRef = useMemoFirebase(() => {
        if (!firestore || !tenantId) return null;
        return doc(firestore, `tenants/${tenantId}`);
    }, [firestore, tenantId]);
    const { data: tenant, isLoading: tenantLoading } = useDoc<Tenant>(tenantDocRef);
    
    const clientDocRef = useMemoFirebase(() => {
        if (!firestore || !tenantId || !appointmentData?.clientId) return null;
        return doc(firestore, `tenants/${tenantId}/clients`, appointmentData.clientId);
    }, [firestore, tenantId, appointmentData?.clientId]);
    const { data: client, isLoading: clientLoading } = useDoc<Client>(clientDocRef);

    const serviceDocRef = useMemoFirebase(() => {
        if (!firestore || !tenantId || !appointmentData?.serviceId) return null;
        return doc(firestore, `tenants/${tenantId}/services`, appointmentData.serviceId);
    }, [firestore, tenantId, appointmentData?.serviceId]);
    const { data: service, isLoading: serviceLoading } = useDoc<Service>(serviceDocRef);

    const staffDocRef = useMemoFirebase(() => {
        if (!firestore || !tenantId || !appointmentData?.staffId) return null;
        return doc(firestore, `tenants/${tenantId}/staff`, appointmentData.staffId);
    }, [firestore, tenantId, appointmentData?.staffId]);
    const { data: assignedStaff, isLoading: staffLoading } = useDoc<Staff>(staffDocRef);

    const allAppointmentsQuery = useMemoFirebase(() => {
        if (!firestore || !tenantId) return null;
        return collection(firestore, `tenants/${tenantId}/appointments`);
    }, [firestore, tenantId]);
    const { data: allAppointmentsFromDB, isLoading: allAppointmentsLoading } = useCollection<Appointment>(allAppointmentsQuery);
    
    const scheduleProfilesQuery = useMemoFirebase(() => {
        if (!firestore || !tenantId) return null;
        return query(collection(firestore, `tenants/${tenantId}/scheduleProfiles`), where("isActive", "==", true));
    }, [firestore, tenantId]);
    const { data: scheduleProfiles, isLoading: scheduleProfilesLoading } = useCollection<any>(scheduleProfilesQuery);

    const publicScheduleProfile = useMemo(() => scheduleProfiles?.[0], [scheduleProfiles]);

    const allAppointments = useMemo(() => {
        if (!allAppointmentsFromDB) return [];
        return allAppointmentsFromDB.map(apt => ({
            ...apt,
            startTime: safeDate(apt.startTime),
            endTime: safeDate(apt.endTime),
        }));
    }, [allAppointmentsFromDB]);
    
    const appointment = useMemo(() => {
        if (!appointmentData) return null;
        return {
            ...appointmentData,
            startTime: safeDate(appointmentData.startTime),
            endTime: safeDate(appointmentData.endTime),
        };
    }, [appointmentData]);

    // UI State
    const [currentStatus, setCurrentStatus] = useState<Appointment['checkInStatus']>('pending');
    const [lateTime, setLateTime] = useState(0);
    const [showLateOptions, setShowLateOptions] = useState(false);
    const [rescheduleStep, setRescheduleStep] = useState<'initial' | 'payment' | 'reschedule' | 'confirmed'>('initial');
    
    const [rescheduleDate, setRescheduleDate] = useState<Date>(new Date());
    const [rescheduleTime, setRescheduleTime] = useState<string>('');
    
    const weekStart = useMemo(() => startOfWeek(rescheduleDate), [rescheduleDate]);
    const weekDays = useMemo(() => eachDayOfInterval({ start: weekStart, end: addDays(weekStart, 6) }), [weekStart]);

    const handlePreviousWeek = () => setRescheduleDate(prev => subWeeks(prev, 1));
    const handleNextWeek = () => setRescheduleDate(prev => addWeeks(prev, 1));
    const handleDateSelect = (day: Date) => setRescheduleDate(day);

    const timeSlots = useMemo(() => {
        if (!service || !rescheduleDate || !allAppointments || !publicScheduleProfile) return [];

        const bookingInterval = publicScheduleProfile.bookingSlotInterval || 15;
        const dayName = format(rescheduleDate, 'eeee').toLowerCase();
        const businessDayHours = publicScheduleProfile.week[dayName];
        if (!businessDayHours || !businessDayHours.enabled) return [];
        
        const openTimeParts = businessDayHours.start.match(/(\d+):(\d+) (AM|PM)/);
        const closeTimeParts = businessDayHours.end.match(/(\d+):(\d+) (AM|PM)/);

        if (!openTimeParts || !closeTimeParts) return [];

        let openHour = parseInt(openTimeParts[1]); if (openTimeParts[3] === 'PM' && openHour < 12) openHour += 12; if (openTimeParts[3] === 'AM' && openHour === 12) openHour = 0;
        let closeHour = parseInt(closeTimeParts[1]); if (closeTimeParts[3] === 'PM' && closeHour < 12) closeHour += 12; if (closeTimeParts[3] === 'AM' && closeHour === 12) closeHour = 0;

        const dayStartWithBusinessHours = setMinutes(setHours(startOfDay(rescheduleDate), openHour), parseInt(openTimeParts[2]));
        const dayEndWithBusinessHours = setMinutes(setHours(startOfDay(rescheduleDate), closeHour), parseInt(closeTimeParts[2]));
        
        const busyIntervals = allAppointments.filter(apt => apt.id !== appointment?.id && isSameDay(apt.startTime, rescheduleDate)).map(apt => ({ start: apt.startTime, end: apt.endTime }));

        const options: string[] = [];
        let currentTime = dayStartWithBusinessHours;
        while (currentTime < dayEndWithBusinessHours) {
            const potentialStartTime = currentTime;
            const totalDuration = service.duration;
            const potentialEndTime = addMinutes(potentialStartTime, totalDuration);
            
            if (potentialEndTime <= dayEndWithBusinessHours && !busyIntervals.some(interval => areIntervalsOverlapping({ start: currentTime, end: potentialEndTime }, interval, { inclusive: false }))) {
                options.push(format(currentTime, 'HH:mm'));
            }
            currentTime = addMinutes(currentTime, bookingInterval);
        }
        return options;
    }, [rescheduleDate, service, allAppointments, appointment?.id, publicScheduleProfile]);


    useEffect(() => {
        if (appointment?.checkInStatus) {
            setCurrentStatus(appointment.checkInStatus);
            if (appointment.checkInStatus === 'running_late') {
                setLateTime(appointment.lateTimeMinutes || 0);
            }
        }
    }, [appointment]);

    const handleUpdateStatus = (newStatus: Appointment['checkInStatus'], lateMinutes?: number, cancellationReason?: string) => {
        if (!appointment || !firestore || !tenantId) return;
        
        const updateData: Partial<Appointment> = { checkInStatus: newStatus };
        if (lateMinutes !== undefined) {
            updateData.lateTimeMinutes = lateMinutes;
        }

        if (newStatus === 'auto_cancelled') {
             (updateData as any).status = 'cancelled';
             (updateData as any).cancellationReason = 'late';
        }

        const appointmentCheckInRef = doc(firestore, 'appointmentCheckIns', token);
        updateDocumentNonBlocking(appointmentCheckInRef, updateData);

        setCurrentStatus(newStatus);
    };

    const handleConfirmLate = () => {
        const gracePeriod = tenant?.lateArrivalGracePeriod || 15;
        const autoCancelEnabled = tenant?.autoCancelLateArrivals !== false;

        if (autoCancelEnabled && lateTime > gracePeriod) {
            handleUpdateStatus('auto_cancelled');
            setRescheduleStep('initial');
        } else {
            handleUpdateStatus('running_late', lateTime);
        }
        setShowLateOptions(false);
    };

    const handlePayFee = () => {
        if (!appointment || !client || !firestore || !tenantId) return;
        
        const newTransaction: Omit<Transaction, 'id'> = {
            date: new Date().toISOString(),
            description: `Late cancellation fee for appointment #${appointment.id.slice(-6).toUpperCase()}`,
            clientOrVendor: client.name,
            type: 'income',
            context: 'Business',
            category: 'Cancellation Fee',
            amount: tenant?.cancellationFee || 25.00,
            paymentMethod: 'Card Online',
            hasReceipt: false,
        };
        const transactionsRef = collection(firestore, 'tenants', tenantId, 'transactions');
        addDocumentNonBlocking(transactionsRef, newTransaction);
        
        toast({
            title: 'Payment Successful!',
            description: 'Your cancellation fee has been paid.',
        });
        setRescheduleStep('reschedule');
    };

    const handleReschedule = async () => {
        if (!appointment || !firestore || !service || !rescheduleDate || !rescheduleTime || !tenantId) return;

        const [hours, minutes] = rescheduleTime.split(':').map(Number);
        const startDateTime = setMinutes(setHours(startOfDay(rescheduleDate), hours), minutes);

        const newEndTime = addMinutes(startDateTime, service.duration);
        
        const updateData: any = {
            startTime: startDateTime.toISOString(),
            endTime: newEndTime.toISOString(),
            status: 'confirmed' as const,
            checkInStatus: 'pending' as const,
            lateTimeMinutes: 0,
            automatedRescheduleOffered: true,
            tenantId: tenantId,
        };

        const appointmentCheckInRef = doc(firestore, 'appointmentCheckIns', token);
        await updateDocumentNonBlocking(appointmentCheckInRef, updateData);
        
        setRescheduleStep('confirmed');
    };
    
    const isLoading = appointmentLoading || clientLoading || serviceLoading || allAppointmentsLoading || scheduleProfilesLoading || tenantLoading || staffLoading;

    if (isLoading) {
        return (
            <div className="flex flex-col items-center gap-4">
                <Loader className="h-8 w-8 animate-spin" />
                <p className="text-muted-foreground">Loading your appointment...</p>
            </div>
        );
    }
    
    if (!appointment || !client || !service || !tenant) {
        return (
            <Card className="w-full max-w-md">
                <CardHeader className="text-center"><CardTitle>Appointment Not Found</CardTitle></CardHeader>
                <CardContent><p className="text-center text-muted-foreground">We couldn't find an appointment associated with this link. It may have expired or been cancelled.</p></CardContent>
                <CardFooter><Button className="w-full" onClick={() => router.push('/')}>Go to Homepage</Button></CardFooter>
            </Card>
        );
    }
    
    if (appointment.status === 'servicing') return <ServicingView serviceName={service.name} />;
    if (appointment.status === 'ready_for_checkout') {
        const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(`clarityflow://checkout/${appointment.id}`)}`;
        // Use the real appointment ID for the short-code
        const ticketId = appointment.id.slice(-6).toUpperCase();
        return <CheckoutView qrCodeUrl={qrCodeUrl} ticketId={ticketId} />;
    }
    if (appointment.status === 'completed') return <ThankYouView tenantId={tenant.id} />;
    if (appointment.status === 'cancelled') return <CancelledView tenantId={tenant.id} />;

    const renderCancellationFlow = () => {
        switch (rescheduleStep) {
            case 'initial':
                return (
                    <div className="p-4 bg-destructive/10 text-destructive text-center rounded-lg space-y-4">
                        <AlertTriangle className="w-8 h-8 mx-auto"/>
                        <h3 className="font-bold">Appointment Cancelled</h3>
                        <p className="text-xs">
                            Your appointment has been automatically cancelled as your arrival time is outside the {tenant.lateArrivalGracePeriod || 15}-minute grace period.
                        </p>
                        <div className="pt-4 border-t border-destructive/20">
                                <p className="text-sm">A cancellation fee of <strong>${(tenant.cancellationFee || 25).toFixed(2)}</strong> is required to rebook.</p>
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
                           Please confirm to pay the ${(tenant.cancellationFee || 25).toFixed(2)} cancellation fee with your card on file.
                        </p>
                        <div className="pt-4">
                             <Button className="mt-4 w-full" onClick={handlePayFee}>
                                Pay ${(tenant.cancellationFee || 25).toFixed(2)} Now
                             </Button>
                             <Button variant="link" size="sm" className="mt-2" onClick={() => setRescheduleStep('initial')}>Cancel</Button>
                        </div>
                    </div>
                );
            case 'reschedule':
                 const isDayClosed = (day: Date) => {
                    if (!publicScheduleProfile) return true;
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
                        <Button variant="link" size="sm" className="mt-2 w-full" onClick={() => { handleUpdateStatus('cancelled'); }}>
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


    return (
        <Card className="w-full max-w-md">
            <CardHeader className="text-center">
                <div className="flex justify-center mb-4"><ClarityFlowLogo /></div>
                <CardTitle>Hello, {client.name.split(' ')[0] || 'there'}!</CardTitle>
                <CardDescription>Ready for your appointment?</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="p-4 rounded-lg bg-muted/50 border space-y-3">
                     <div className="flex items-center gap-3">
                        <Avatar className="w-12 h-12">
                            <AvatarImage src={service.imageUrl} alt={service.name} />
                            <AvatarFallback className="bg-muted">
                                <Scissors className="w-6 h-6 text-muted-foreground" />
                            </AvatarFallback>
                        </Avatar>
                        <div>
                             <p className="font-semibold">{service.name}</p>
                             <p className="text-sm text-muted-foreground">{format(appointment.startTime, 'EEEE, MMMM d')} at {format(appointment.startTime, 'h:mm a')}</p>
                        </div>
                    </div>
                    {assignedStaff && (
                        <div className="pt-3 border-t">
                            <div className="flex items-center gap-3">
                                <Avatar className="h-8 w-8">
                                    <AvatarImage src={assignedStaff.avatarUrl} />
                                    <AvatarFallback>{assignedStaff.name.charAt(0)}</AvatarFallback>
                                </Avatar>
                                <div className="text-xs text-left">
                                    <p className="font-bold text-muted-foreground uppercase tracking-widest text-[9px]">Your Professional</p>
                                    <p className="font-semibold">{assignedStaff.name}</p>
                                </div>
                            </div>
                        </div>
                    )}
                    <div className="text-sm text-muted-foreground space-y-2 pt-3 border-t">
                        <div className="flex items-center gap-2"><Clock className="w-4 h-4"/> Duration: {service.duration} minutes</div>
                        <div className="flex items-center gap-2"><MapPin className="w-4 h-4"/> {tenant.name}</div>
                    </div>
                </div>
                
                {currentStatus === 'auto_cancelled' ? renderCancellationFlow() : showLateOptions ? (
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
                        
                        {lateTime > (tenant.lateArrivalGracePeriod || 15) && (
                            <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-center">
                                <AlertTriangle className="w-6 h-6 mx-auto mb-2"/>
                                <p className="font-semibold">Please Be Aware</p>
                                <p className="text-xs">Arrivals more than {tenant.lateArrivalGracePeriod || 15} minutes late may need to be rescheduled. A fee of ${(tenant.cancellationFee || 25).toFixed(2)} may apply.</p>
                            </div>
                        )}

                        <div className="grid grid-cols-2 gap-4">
                            <Button variant="outline" onClick={() => {setShowLateOptions(false); setLateTime(0)}}>Cancel</Button>
                             <Button onClick={handleConfirmLate} disabled={lateTime === 0}>
                                {lateTime > (tenant.lateArrivalGracePeriod || 15) ? 'I Understand' : 'Confirm'}
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
