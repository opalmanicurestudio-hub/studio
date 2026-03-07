'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Clock, Car, MapPin, Check, AlertTriangle, X, CreditCard, Loader, ChevronLeft, ChevronRight, TicketIcon, User as UserIcon, Scissors, CheckCircle, Wallet, CheckCircle2, Sparkles, Zap, Calendar as CalendarIcon, ShieldCheck, Ban, XCircle, ShoppingCart, Fingerprint } from 'lucide-react';
import { format, parseISO, addMinutes, areIntervalsOverlapping, isBefore, startOfDay, setHours, setMinutes, eachDayOfInterval, startOfWeek, isSameDay, subWeeks, addWeeks, addDays, isToday } from 'date-fns';
import { ClarityFlowLogo } from '@/components/shared/AppSidebar';
import { type Appointment, type Client, type Service, type Tenant, type Staff } from '@/lib/data';
import { type Transaction } from '@/lib/financial-data';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { useFirebase, useCollection, useMemoFirebase, updateDocumentNonBlocking, addDocumentNonBlocking, useDoc } from '@/firebase';
import { collection, query, where, doc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import Image from 'next/image';
import Link from 'next/link';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * Utility to safely convert potential strings or Date objects into valid Date instances.
 */
const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val === 'string') return parseISO(val);
    if (typeof val?.toDate === 'function') return val.toDate();
    return new Date(val);
};

const ViewContainer = ({ children }: { children: React.ReactNode }) => (
    <motion.div 
        initial={{ opacity: 0, y: 20 }} 
        animate={{ opacity: 1, y: 0 }} 
        className="w-full max-w-lg"
    >
        <Card className="border-4 rounded-[3rem] shadow-3xl overflow-hidden bg-white/90 backdrop-blur-xl">
            {children}
        </Card>
    </motion.div>
);

const ViewHeader = ({ title, subtitle, icon: Icon }: { title: string, subtitle: string, icon?: any }) => (
    <CardHeader className="p-8 pb-6 border-b bg-muted/5 text-left">
        <div className="flex items-center gap-3 mb-2">
            {Icon ? <Icon className="w-5 h-5 text-primary" /> : <Sparkles className="w-5 h-5 text-primary" />}
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Studio Portal</span>
        </div>
        <CardTitle className="text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">{title}</CardTitle>
        <CardDescription className="text-xs font-bold uppercase tracking-widest opacity-60 mt-1">{subtitle}</CardDescription>
    </CardHeader>
);

const ServicingView = ({ serviceName }: { serviceName: string }) => (
    <ViewContainer>
        <ViewHeader title="In Service" subtitle="Your session is active" icon={Clock} />
        <CardContent className="p-10 text-center space-y-6">
            <div className="w-24 h-24 bg-primary/10 rounded-[2rem] flex items-center justify-center mx-auto shadow-2xl shadow-primary/5 rotate-6">
                <Scissors className="w-12 h-12 text-primary -rotate-6" />
            </div>
            <div className="space-y-2">
                <p className="font-black text-xl uppercase tracking-tight text-slate-900">Sit Back & Relax</p>
                <p className="text-sm font-medium text-slate-500 leading-relaxed">Your <strong>{serviceName}</strong> is currently underway. We'll provide your checkout ticket once complete.</p>
            </div>
        </CardContent>
    </ViewContainer>
);

const CheckoutView = ({ qrCodeUrl, ticketId }: { qrCodeUrl: string, ticketId: string }) => (
    <ViewContainer>
        <ViewHeader title="Finalize" subtitle="Ready for checkout" icon={ShoppingCart} />
        <CardContent className="p-8 text-center space-y-8">
            <p className="text-sm font-bold text-slate-600 uppercase tracking-tight">Scan this code at the desk to pay.</p>
            <div className="p-6 bg-white rounded-[2.5rem] shadow-2xl border-4 border-primary/10 inline-block mx-auto">
                <Image src={qrCodeUrl} alt="Checkout QR Code" width={220} height={220} className="rounded-xl" />
            </div>
            <div className="bg-primary/5 p-6 rounded-[2rem] border-2 border-primary/10 space-y-1">
                <p className="text-[10px] uppercase font-black tracking-widest text-primary/60">Checkout Ticket</p>
                <p className="text-4xl font-black font-mono tracking-tighter text-primary">#{ticketId}</p>
            </div>
        </CardContent>
    </ViewContainer>
);

const ThankYouView = ({ tenantId }: { tenantId: string }) => (
    <ViewContainer>
        <ViewHeader title="Complete" subtitle="Session Finished" icon={CheckCircle2} />
        <CardContent className="p-10 text-center space-y-8">
            <div className="w-24 h-24 bg-green-500/10 rounded-[2rem] flex items-center justify-center mx-auto shadow-2xl shadow-green-500/5 -rotate-6">
                <CheckCircle2 className="w-12 h-12 text-green-500 rotate-6" />
            </div>
            <div className="space-y-2">
                <p className="font-black text-xl uppercase tracking-tight text-slate-900">Thank You!</p>
                <p className="text-sm font-medium text-slate-500 leading-relaxed">We hope you enjoyed your experience. We look forward to seeing you again soon.</p>
            </div>
        </CardContent>
        <CardFooter className="p-8 pt-0 flex flex-col gap-3">
            <Button asChild className="w-full h-14 rounded-2xl text-lg font-black uppercase shadow-xl shadow-primary/20"><Link href={`/book/${tenantId}`}>Book Next Session</Link></Button>
            <Button variant="ghost" className="w-full h-10 font-bold uppercase text-[10px] tracking-widest text-muted-foreground">Leave a Review</Button>
        </CardFooter>
    </ViewContainer>
);

const CancelledView = ({ tenantId }: { tenantId?: string }) => (
    <ViewContainer>
        <ViewHeader title="Cancelled" subtitle="Appointment Void" icon={Ban} />
        <CardContent className="p-10 text-center space-y-6">
            <div className="w-24 h-24 bg-destructive/10 rounded-[2rem] flex items-center justify-center mx-auto shadow-2xl shadow-destructive/5 rotate-12">
                <XCircle className="w-12 h-12 text-destructive -rotate-12" />
            </div>
            <div className="space-y-2">
                <p className="font-black text-xl uppercase tracking-tight text-slate-900">Session Voided</p>
                <p className="text-sm font-medium text-slate-500 leading-relaxed">This appointment is no longer on our active schedule. Please contact us if this is an error.</p>
            </div>
        </CardContent>
        <CardFooter className="p-8 pt-0 flex flex-col gap-3">
            {tenantId && (
                <Button asChild className="w-full h-14 rounded-2xl text-lg font-black uppercase shadow-xl shadow-primary/20">
                    <Link href={`/book/${tenantId}`}>Secure New Window</Link>
                </Button>
            )}
            <Button asChild variant="ghost" className="w-full font-bold uppercase text-[10px] tracking-widest text-muted-foreground">
                <Link href="/">Return to Homepage</Link>
            </Button>
        </CardFooter>
    </ViewContainer>
);

const timeStringToDate = (timeStr: string, date: Date): Date => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    if (!timeStr) return d;
    const [time, period] = timeStr.split(' ');
    let [hours, minutes] = time.split(':').map(Number);
    if (period === 'PM' && hours < 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
    d.setHours(hours, minutes);
    return d;
}

export default function CheckInPage() {
    const params = useParams();
    const router = useRouter();
    const token = params.token as string;
    const { toast } = useToast();
    const { firestore } = useFirebase();

    const appointmentCheckInRef = useMemoFirebase(() => {
        if (!firestore || !token) return null;
        return doc(firestore, 'appointmentCheckIns', token);
    }, [firestore, token]);
    const { data: appointmentData, isLoading: appointmentLoading } = useDoc<Appointment>(appointmentCheckInRef);

    const tenantId = useMemo(() => appointmentData?.tenantId, [appointmentData]);

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

    const [currentStatus, setCurrentStatus] = useState<Appointment['checkInStatus']>('pending');
    const [lateTime, setLateTime] = useState(0);
    const [showLateOptions, setShowLateOptions] = useState(false);
    const [rescheduleStep, setRescheduleStep] = useState<'initial' | 'payment' | 'reschedule' | 'confirmed'>('initial');
    const [rescheduleDate, setRescheduleDate] = useState<Date>(new Date());
    const [rescheduleTime, setRescheduleTime] = useState<string>('');
    
    const weekStart = useMemo(() => startOfWeek(rescheduleDate), [rescheduleDate]);
    const weekDays = useMemo(() => eachDayOfInterval({ start: weekStart, end: addDays(weekStart, 6) }), [weekStart]);

    const isDayClosed = (day: Date) => {
        if (!publicScheduleProfile) return true;
        const dayName = format(day, 'eeee').toLowerCase();
        const dayHours = publicScheduleProfile.week[dayName];
        return !dayHours || !dayHours.enabled;
    };

    const handleDateSelect = (day: Date) => {
        setRescheduleDate(day);
        setRescheduleTime('');
    };

    const timeSlots = useMemo(() => {
        if (!service || !rescheduleDate || !allAppointments || !publicScheduleProfile) return [];
        const bookingInterval = publicScheduleProfile.bookingSlotInterval || 15;
        const dayName = format(rescheduleDate, 'eeee').toLowerCase();
        const businessDayHours = publicScheduleProfile.week[dayName];
        if (!businessDayHours || !businessDayHours.enabled) return [];
        
        const dayStartWithBusinessHours = timeStringToDate(businessDayHours.start, rescheduleDate);
        const dayEndWithBusinessHours = timeStringToDate(businessDayHours.end, rescheduleDate);
        
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

    const handleUpdateStatus = (newStatus: Appointment['checkInStatus'], lateMinutes?: number) => {
        if (!appointment || !firestore || !tenantId) return;
        const updateData: Partial<Appointment> = { checkInStatus: newStatus };
        if (lateMinutes !== undefined) updateData.lateTimeMinutes = lateMinutes;
        if (newStatus === 'auto_cancelled') {
             (updateData as any).status = 'cancelled';
             (updateData as any).cancellationReason = 'late';
             (updateData as any).cancellationFeeApplied = tenant?.cancellationFee || 0;
        }
        updateDocumentNonBlocking(doc(firestore, 'appointmentCheckIns', token), updateData);

        if (appointment.staffId) {
            const statusLabels = {
                on_my_way: 'is on their way',
                arrived: 'has arrived',
                running_late: `is running ${lateMinutes} minutes late`,
                auto_cancelled: 'appointment was auto-cancelled due to lateness'
            };
            const label = statusLabels[newStatus as keyof typeof statusLabels] || 'updated status';
            addDocumentNonBlocking(collection(firestore, `tenants/${tenantId}/notifications`), {
                userId: appointment.staffId,
                type: 'client_movement',
                message: `${client?.name || appointment.clientName} ${label}.`,
                link: '/planner',
                createdAt: new Date().toISOString(),
                read: false,
            });
        }
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
        addDocumentNonBlocking(collection(firestore, 'tenants', tenantId, 'transactions'), { date: new Date().toISOString(), description: `Late cancellation fee for appointment #${appointment.id.slice(-6).toUpperCase()}`, clientOrVendor: client.name, type: 'income', context: 'Business', category: 'Cancellation Fee', amount: tenant?.cancellationFee || 25.00, paymentMethod: 'Card Online', hasReceipt: false });
        toast({ title: 'Payment Successful!' });
        setRescheduleStep('reschedule');
    };

    const handleReschedule = async () => {
        if (!appointment || !firestore || !service || !rescheduleDate || !rescheduleTime || !tenantId) return;
        const [hours, minutes] = rescheduleTime.split(':').map(Number);
        const startDateTime = setMinutes(setHours(startOfDay(rescheduleDate), hours), minutes);
        const newEndTime = addMinutes(startDateTime, service.duration);
        await updateDocumentNonBlocking(doc(firestore, 'appointmentCheckIns', token), { startTime: startDateTime.toISOString(), endTime: newEndTime.toISOString(), status: 'confirmed' as const, checkInStatus: 'pending' as const, lateTimeMinutes: 0, automatedRescheduleOffered: true, tenantId: tenantId });
        setRescheduleStep('confirmed');
    };
    
    const isLoading = appointmentLoading || clientLoading || serviceLoading || allAppointmentsLoading || scheduleProfilesLoading || tenantLoading || staffLoading;

    if (isLoading) return <div className="flex flex-col items-center gap-4"><Loader className="h-10 w-10 animate-spin text-primary" /><p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground animate-pulse">Initializing Portal...</p></div>;
    
    if (!appointment || !client || !service || !tenant) return <CancelledView />;
    
    if (appointment.status === 'servicing') return <ServicingView serviceName={service.name} />;
    if (appointment.status === 'ready_for_checkout') {
        const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(`clarityflow://checkout/${appointment.id}`)}`;
        return <CheckoutView qrCodeUrl={qrCodeUrl} ticketId={appointment.id.slice(-6).toUpperCase()} />;
    }
    if (appointment.status === 'completed') return <ThankYouView tenantId={tenant.id} />;
    if (appointment.status === 'cancelled' && currentStatus !== 'auto_cancelled') return <CancelledView tenantId={tenant.id} />;

    const renderCancellationFlow = () => {
        switch (rescheduleStep) {
            case 'initial':
                return (
                    <div className="p-8 bg-destructive/5 text-center rounded-[2.5rem] border-4 border-destructive/20 space-y-6 shadow-xl">
                        <AlertTriangle className="w-12 h-12 mx-auto text-destructive"/>
                        <div className="space-y-2">
                            <h3 className="font-black uppercase tracking-tighter text-2xl text-slate-900 leading-none">Access Restricted</h3>
                            <p className="text-xs font-bold text-muted-foreground uppercase leading-relaxed tracking-tight">
                                Arrival is outside the {tenant.lateArrivalGracePeriod || 15}-minute grace period. This slot has been voided.
                            </p>
                        </div>
                        <div className="pt-6 border-t border-destructive/10 space-y-4">
                                <p className="text-sm font-bold">A cancellation recovery fee of <strong className="text-xl tracking-tighter text-destructive font-black font-mono">${(tenant.cancellationFee || 25).toFixed(2)}</strong> is required to rebook.</p>
                                <Button className="w-full h-16 rounded-2xl bg-destructive text-destructive-foreground hover:bg-destructive/90 text-lg font-black uppercase shadow-2xl shadow-destructive/20" onClick={() => setRescheduleStep('payment')}>
                                Pay Fee & Reschedule
                                </Button>
                        </div>
                    </div>
                );
            case 'payment':
                 return (
                     <div className="p-8 bg-white text-center rounded-[2.5rem] border-4 border-primary/10 space-y-8 shadow-xl">
                        <CreditCard className="w-12 h-12 mx-auto text-primary opacity-40"/>
                        <div className="space-y-2">
                            <h3 className="font-black uppercase tracking-tighter text-2xl text-slate-900">Authorize Payment</h3>
                            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest leading-relaxed">
                                Confirm the ${(tenant.cancellationFee || 25).toFixed(2)} recovery fee with your card on file.
                            </p>
                        </div>
                        <div className="pt-4 flex flex-col gap-3">
                             <Button className="h-16 rounded-2xl text-xl font-black uppercase shadow-2xl shadow-primary/20" onClick={handlePayFee}>
                                Collect & Unlock
                             </Button>
                             <Button variant="ghost" className="font-black uppercase tracking-widest text-[10px]" onClick={() => setRescheduleStep('initial')}>Cancel</Button>
                        </div>
                    </div>
                );
            case 'reschedule':
                return (
                    <Card className="bg-primary/[0.02] border-4 border-primary/10 rounded-[2.5rem] p-8 space-y-10 shadow-inner">
                        <div className="text-center space-y-2">
                            <div className="w-16 h-16 bg-green-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4 border-2 border-green-500/20"><Check className="w-8 h-8 text-green-500"/></div>
                            <h3 className="font-black uppercase tracking-tighter text-2xl">Payment Received</h3>
                            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Select a new window for your session.</p>
                        </div>

                        <div className="space-y-8">
                            <div className="space-y-4">
                                <div className="flex justify-between items-center px-2">
                                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Select Date</h3>
                                    <div className="flex items-center gap-2">
                                        <Button variant="outline" size="icon" className="h-8 w-8 rounded-full bg-white shadow-sm border-none" onClick={() => setRescheduleDate(prev => subWeeks(prev, 1))}><ChevronLeft className="w-4 h-4"/></Button>
                                        <span className="font-black uppercase text-[10px] tracking-widest">{format(rescheduleDate, 'MMMM yyyy')}</span>
                                        <Button variant="outline" size="icon" className="h-8 w-8 rounded-full bg-white shadow-sm border-none" onClick={() => setRescheduleDate(prev => addWeeks(prev, 1))}><ChevronRight className="w-4 h-4"/></Button>
                                    </div>
                                </div>
                                <div className="grid grid-cols-7 gap-2">
                                    {weekDays.map(day => (
                                        <button
                                            key={day.toISOString()}
                                            onClick={() => handleDateSelect(day)}
                                            disabled={isDayClosed(day)}
                                            className={cn(
                                                "flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all aspect-square",
                                                isSameDay(day, rescheduleDate)
                                                    ? "bg-primary text-primary-foreground border-primary shadow-xl scale-110"
                                                    : "bg-white border-transparent hover:border-primary/20",
                                                isDayClosed(day) && "opacity-20 cursor-not-allowed"
                                            )}
                                        >
                                            <span className="text-[8px] uppercase font-black opacity-60 mb-1">{format(day, 'E')}</span>
                                            <span className="font-black text-lg tracking-tighter">{format(day, 'd')}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                            
                            <div className="space-y-4">
                                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground px-2">Select Start Time</h3>
                                <div className="grid grid-cols-3 gap-2">
                                    {timeSlots.map(slot => (
                                        <Button 
                                            key={slot} 
                                            variant={rescheduleTime === slot ? 'default' : 'outline'}
                                            className={cn("h-12 rounded-xl font-black uppercase text-[10px] tracking-widest border-2", rescheduleTime === slot ? "shadow-lg shadow-primary/20" : "bg-white")}
                                            onClick={() => setRescheduleTime(slot)}
                                        >
                                            {format(parseISO(`1970-01-01T${slot}:00`), 'h:mm a')}
                                        </Button>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <Button onClick={handleReschedule} disabled={!rescheduleTime} className="w-full h-16 rounded-[2rem] text-xl font-black uppercase shadow-2xl shadow-primary/30">
                            Confirm New Session
                        </Button>
                        <Button variant="ghost" className="w-full font-black uppercase tracking-widest text-[10px] text-muted-foreground" onClick={() => { handleUpdateStatus('cancelled'); }}>No, Cancel Entirely</Button>
                    </Card>
                );
            case 'confirmed':
                 return (
                     <div className="p-10 bg-green-500/10 border-4 border-green-500/20 text-green-700 rounded-[3rem] text-center space-y-4 shadow-xl">
                        <CheckCircle2 className="w-16 h-16 mx-auto mb-2" />
                        <h3 className="text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">Dossier Updated</h3>
                        <p className="text-sm font-bold uppercase tracking-tight opacity-80">Your session has been successfully rescheduled. See you soon!</p>
                    </div>
                );
        }
    }

    return (
        <ViewContainer>
            <ViewHeader title="Identity Check" subtitle="Verify your session" icon={Fingerprint} />
            <CardContent className="p-8 md:p-10 space-y-10">
                {client.outstandingBalance && client.outstandingBalance > 0 && (
                    <Alert variant="destructive" className="bg-destructive/5 border-destructive border-4 rounded-[2.5rem] p-6 shadow-2xl shadow-destructive/10">
                        <Wallet className="h-6 w-6 text-destructive" />
                        <AlertTitle className="text-sm font-black uppercase tracking-tight mb-2">Arrears Alert</AlertTitle>
                        <AlertDescription className="text-xs font-bold leading-relaxed opacity-80 uppercase">
                            Account balance of <strong className="text-lg tracking-tighter text-destructive">${client.outstandingBalance.toFixed(2)}</strong> detected. Settle with your professional today.
                        </AlertDescription>
                    </Alert>
                )}

                <div className="p-6 md:p-8 rounded-[2.5rem] bg-muted/10 border-2 border-border/50 space-y-6 shadow-inner">
                     <div className="flex items-center gap-6">
                        <Avatar className="w-16 h-16 md:w-20 md:h-20 rounded-2xl border-4 border-background shadow-xl">
                            <AvatarImage src={service.imageUrl} className="object-cover" />
                            <AvatarFallback className="bg-primary/10 text-primary"><Scissors className="w-8 h-8" /></AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1 text-left">
                             <p className="font-black text-lg md:text-2xl uppercase tracking-tighter text-slate-900 leading-none mb-2 truncate">{service.name}</p>
                             <p className="text-[10px] md:text-xs font-black uppercase tracking-widest text-primary">{format(appointment.startTime, 'EEEE, MMMM d')} &middot; {format(appointment.startTime, 'h:mm a')}</p>
                        </div>
                    </div>
                    {assignedStaff && (
                        <div className="pt-6 border-t border-dashed border-border/50">
                            <div className="flex items-center gap-4">
                                <Avatar className="h-10 w-10 border-2 border-background shadow-md rounded-xl">
                                    <AvatarImage src={assignedStaff.avatarUrl} className="object-cover" />
                                    <AvatarFallback className="font-black text-xs bg-primary/10 text-primary">{(assignedStaff.name || 'S').charAt(0)}</AvatarFallback>
                                </Avatar>
                                <div className="text-left">
                                    <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60 leading-none mb-1">Your Professional</p>
                                    <p className="font-black text-sm uppercase tracking-tight text-slate-800 leading-none">{assignedStaff.name}</p>
                                </div>
                            </div>
                        </div>
                    )}
                    <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 pt-6 border-t border-dashed border-border/50">
                        <div className="flex items-center gap-2"><Clock className="w-3.5 h-3.5"/> {service.duration}m</div>
                        <div className="flex items-center gap-2 truncate max-w-[150px]"><MapPin className="w-3.5 h-3.5"/> {tenant.name}</div>
                    </div>
                </div>
                
                {currentStatus === 'auto_cancelled' ? renderCancellationFlow() : showLateOptions ? (
                    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2">
                         <h4 className="text-lg font-black uppercase tracking-tighter text-center text-slate-900">Estimated Delay?</h4>
                        <RadioGroup 
                            value={lateTime > 0 ? String(lateTime) : undefined}
                            onValueChange={(val) => setLateTime(parseInt(val))} 
                            className="grid grid-cols-4 gap-3"
                        >
                            {['5', '10', '15', '20'].map(m => (
                                <div key={m}>
                                    <RadioGroupItem value={m} id={`late-${m}`} className="peer sr-only" />
                                    <Label htmlFor={`late-${m}`} className="flex items-center justify-center h-14 rounded-2xl border-4 border-muted font-black text-lg cursor-pointer transition-all peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 peer-data-[state=checked]:text-primary hover:bg-muted/50">{m === '20' ? '20+' : m}</Label>
                                </div>
                            ))}
                        </RadioGroup>
                        
                        {lateTime > (tenant.lateArrivalGracePeriod || 15) && (
                            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="p-6 rounded-[2rem] bg-destructive/10 border-4 border-destructive/20 text-destructive text-center space-y-3 shadow-xl shadow-destructive/5">
                                <AlertTriangle className="w-8 h-8 mx-auto mb-1 animate-pulse"/>
                                <p className="font-black uppercase tracking-tight text-base leading-none">Policy Warning</p>
                                <p className="text-[10px] font-bold uppercase leading-relaxed tracking-tight opacity-80">Arrivals past {tenant.lateArrivalGracePeriod || 15}m may require a ${tenant.cancellationFee?.toFixed(2)} recovery fee.</p>
                            </motion.div>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <Button variant="ghost" className="h-14 rounded-2xl font-black uppercase tracking-widest text-xs text-muted-foreground" onClick={() => {setShowLateOptions(false); setLateTime(0)}}>Back</Button>
                             <Button onClick={handleConfirmLate} disabled={lateTime === 0} className="h-14 rounded-2xl font-black uppercase tracking-widest text-xs shadow-2xl shadow-primary/20">
                                {lateTime > (tenant.lateArrivalGracePeriod || 15) ? 'I Accept Terms' : 'Update Arrival'}
                             </Button>
                        </div>
                    </div>
                ) : currentStatus === 'pending' ? (
                    <div className="flex flex-col gap-4">
                        <div className="grid grid-cols-2 gap-4">
                            <Button 
                                size="lg" 
                                onClick={() => setShowLateOptions(true)} 
                                variant="outline" 
                                className="h-20 rounded-3xl border-4 font-black uppercase tracking-widest text-xs flex flex-col gap-2"
                            >
                                <Clock className="h-6 w-6 opacity-40" />
                                Running Late
                            </Button>
                            <Button 
                                size="lg" 
                                onClick={() => handleUpdateStatus('on_my_way')} 
                                className="h-20 rounded-3xl border-4 border-primary/20 bg-primary/5 text-primary font-black uppercase tracking-widest text-xs flex flex-col gap-2 shadow-inner"
                            >
                                <Car className="h-6 w-6" /> 
                                On My Way
                            </Button>
                        </div>
                        <Button 
                            size="lg" 
                            variant="default" 
                            onClick={() => handleUpdateStatus('arrived')} 
                            className="h-20 rounded-[2rem] font-black uppercase tracking-[0.2em] text-lg shadow-3xl shadow-primary/30 active:scale-95 transition-all"
                        >
                            <MapPin className="mr-3 h-6 w-6" /> 
                            I Have Arrived
                        </Button>
                    </div>
                ) : currentStatus === 'on_my_way' ? (
                    <div className="space-y-8 animate-in zoom-in-95 duration-500">
                        <div className="p-8 bg-primary/5 border-4 border-primary/20 rounded-[2.5rem] text-center space-y-4 shadow-xl">
                            <div className="w-20 h-20 bg-primary rounded-3xl flex items-center justify-center mx-auto shadow-2xl shadow-primary/30 -rotate-6 animate-bounce">
                                <Car className="w-10 h-10 text-white" />
                            </div>
                            <div className="space-y-1">
                                <h3 className="text-2xl font-black uppercase tracking-tighter text-slate-900 leading-none">En Route</h3>
                                <p className="text-[10px] font-bold uppercase tracking-widest text-primary opacity-60">We've cleared your path.</p>
                            </div>
                        </div>
                        <Button size="lg" className="w-full h-20 rounded-[2rem] font-black uppercase tracking-[0.2em] text-lg shadow-3xl shadow-primary/30" onClick={() => handleUpdateStatus('arrived')}>
                            <MapPin className="mr-3 h-6 w-6" /> 
                            Tap Upon Arrival
                        </Button>
                    </div>
                ) : currentStatus === 'arrived' ? (
                    <div className="p-10 bg-green-500/10 border-4 border-green-500/20 rounded-[3rem] text-center space-y-6 shadow-xl animate-in zoom-in-95">
                        <div className="w-24 h-24 bg-green-500 rounded-[2rem] flex items-center justify-center mx-auto shadow-2xl shadow-green-500/20 rotate-6">
                            <CheckCircle2 className="w-14 h-14 text-white -rotate-6" />
                        </div>
                        <div className="space-y-2">
                            <h3 className="text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">Checked In</h3>
                            <p className="text-sm font-bold uppercase tracking-tight text-slate-500 opacity-80 leading-relaxed">Relax, we've notified {(assignedStaff?.name || 'your pro').split(' ')[0]}. We'll be with you shortly.</p>
                        </div>
                    </div>
                ) : currentStatus === 'running_late' ? (
                    <div className="space-y-8 animate-in zoom-in-95">
                        <div className="p-10 bg-amber-500/10 border-4 border-amber-500/20 rounded-[3rem] text-center space-y-6 shadow-xl">
                            <div className="w-24 h-24 bg-amber-500 rounded-[2rem] flex items-center justify-center mx-auto shadow-2xl shadow-amber-500/20 -rotate-6">
                                <Clock className="w-14 h-14 text-white rotate-6 animate-pulse" />
                            </div>
                            <div className="space-y-2">
                                <h3 className="text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">Noted: +{lateTime}m</h3>
                                <p className="text-sm font-bold uppercase tracking-tight text-slate-500 opacity-80 leading-relaxed">Thanks for the heads up! We've adjusted your arrival window on our end.</p>
                            </div>
                        </div>
                        <Button size="lg" variant="outline" className="w-full h-20 rounded-[2rem] border-4 font-black uppercase tracking-[0.2em] text-lg hover:bg-green-50 hover:border-green-500/20 group" onClick={() => handleUpdateStatus('arrived')}>
                            <MapPin className="mr-3 h-6 w-6 text-primary group-hover:text-green-600" /> 
                            Tap Upon Arrival
                        </Button>
                    </div>
                ) : null}
            </CardContent>
        </ViewContainer>
    );
}
