

'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Clock, Car, MapPin, Check, AlertTriangle, X } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { Loader } from 'lucide-react';
import { ClarityFlowLogo } from '@/components/shared/AppSidebar';
import { type Appointment, type Client, type Service } from '@/lib/data';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { useFirebase, useCollection, useMemoFirebase, updateDocumentNonBlocking } from '@/firebase';
import { collection, query, where, doc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

export default function CheckInPage() {
    const params = useParams();
    const router = useRouter();
    const token = params.token as string;
    const { toast } = useToast();

    const { firestore, isUserLoading } = useFirebase();

    // Fetch appointment by token
    const appointmentsQuery = useMemoFirebase(() => {
        if (!firestore || !token) return null;
        return query(collection(firestore, 'tenants', 'tenant-abc', 'appointments'), where('checkInToken', '==', token));
    }, [firestore, token]);
    const { data: appointmentsFromDB, isLoading: appointmentsLoading } = useCollection<Appointment>(appointmentsQuery);

    const appointment = useMemo(() => {
        if (!appointmentsFromDB?.[0]) return null;
        const aptData = appointmentsFromDB[0];
        try {
            // Firestore Timestamps need to be converted to JS Dates
            const startTime = (aptData.startTime as any)?.toDate ? (aptData.startTime as any).toDate() : parseISO(aptData.startTime as any);
            const endTime = (aptData.endTime as any)?.toDate ? (aptData.endTime as any).toDate() : parseISO(aptData.endTime as any);
            
            // Check if the conversion resulted in a valid date
            if (isNaN(startTime.getTime())) {
                console.error("Invalid startTime:", aptData.startTime);
                return null;
            }

            return { ...aptData, startTime, endTime };
        } catch (e) {
            console.error("Error parsing appointment dates", e);
            return null;
        }
    }, [appointmentsFromDB]);

    // Fetch all clients and services
    const clientsQuery = useMemoFirebase(() => firestore ? collection(firestore, 'tenants', 'tenant-abc', 'clients') : null, [firestore]);
    const servicesQuery = useMemoFirebase(() => firestore ? collection(firestore, 'tenants', 'tenant-abc', 'services') : null, [firestore]);

    const { data: clients, isLoading: clientsLoading } = useCollection<Client>(clientsQuery);
    const { data: services, isLoading: servicesLoading } = useCollection<Service>(servicesQuery);

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
        const appointmentRef = doc(firestore, 'tenants', 'tenant-abc', 'appointments', appointment.id);
        
        const updateData: Partial<Appointment> = { checkInStatus: newStatus };
        if (lateMinutes !== undefined) {
            updateData.lateTimeMinutes = lateMinutes;
        }

        updateDocumentNonBlocking(appointmentRef, updateData);
        setCurrentStatus(newStatus);
    };

    const handleConfirmLate = () => {
        // These would come from tenant settings in a real app
        const gracePeriod = 15;
        const autoCancelEnabled = true;

        if (autoCancelEnabled && lateTime > gracePeriod) {
            setIsCancelled(true);
        } else {
            handleUpdateStatus('running_late', lateTime);
        }
        setShowLateOptions(false);
    };

    const isLoading = isUserLoading || appointmentsLoading || clientsLoading || servicesLoading;

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
                
                {isCancelled ? (
                     <div className="p-4 bg-destructive/10 text-destructive text-center rounded-lg space-y-4">
                        <AlertTriangle className="w-8 h-8 mx-auto"/>
                        <h3 className="font-bold">Appointment Cancelled</h3>
                        <p className="text-xs">
                            Your appointment has been automatically cancelled as your arrival time is outside the 15-minute grace period.
                        </p>
                        <div className="pt-4 border-t border-destructive/20">
                             <p className="text-sm">A cancellation fee of <strong>$25.00</strong> is required.</p>
                             <Button className="mt-4 w-full bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => {
                                 toast({ title: 'Payment Successful!', description: 'Please contact us to reschedule.' });
                                 handleUpdateStatus('cancelled');
                                 setIsCancelled(false);
                             }}>
                                Pay Fee & Reschedule
                             </Button>
                        </div>
                    </div>
                ) : showLateOptions ? (
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
                                <p className="text-xs">Arrivals more than 15 minutes late may need to be rescheduled or have their service shortened. A fee of $25.00 may apply.</p>
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
