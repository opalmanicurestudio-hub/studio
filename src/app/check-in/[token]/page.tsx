
'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useInventory } from '@/context/InventoryContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Clock, Car, MapPin, Check, AlertTriangle, X } from 'lucide-react';
import { format } from 'date-fns';
import { Loader } from 'lucide-react';
import { ClarityFlowLogo } from '@/components/shared/AppSidebar';
import { Appointment, Client, Service } from '@/lib/data';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';

// Mock function to find appointment by token
const findAppointmentByToken = (token: string, appointments: Appointment[], clients: Client[], services: Service[]) => {
  // In a real app, this would be a secure backend call.
  // For now, let's just find the first upcoming appointment and pretend it matches the token.
  const upcoming = appointments.find(apt => new Date(apt.startTime) > new Date());
  if (!upcoming) return null;

  const client = clients.find(c => c.id === upcoming.clientId);
  const service = services.find(s => s.id === upcoming.serviceId);

  if (!client || !service) return null;

  return { appointment: upcoming, client, service };
};

export default function CheckInPage() {
    const params = useParams();
    const router = useRouter();
    const token = params.token as string;

    const { appointments, clients, services } = useInventory();
    const [data, setData] = useState<{ appointment: Appointment; client: Client; service: Service } | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [status, setStatus] = useState<'pending' | 'on_my_way' | 'arrived' | 'running_late'>('pending');
    const [lateTime, setLateTime] = useState(0);
    const [showLateConfirm, setShowLateConfirm] = useState(false);

    useEffect(() => {
        // Simulating data fetching
        const appointmentData = findAppointmentByToken(token, appointments, clients, services);
        if (appointmentData) {
            setData(appointmentData);
            setStatus(appointmentData.appointment.checkInStatus || 'pending');
            setLateTime(appointmentData.appointment.lateTimeMinutes || 0);
        }
        setIsLoading(false);
    }, [token, appointments, clients, services]);

    const handleOnMyWay = () => setStatus('on_my_way');
    const handleArrived = () => setStatus('arrived');
    const handleRunningLate = () => setStatus('running_late');

    const handleConfirmLate = () => {
        // In a real app, you would save this to the database
        console.log(`Confirmed late by ${lateTime} minutes.`);
        setShowLateConfirm(false);
    };

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
                <CardHeader className="text-center">
                    <CardTitle>Appointment Not Found</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-center text-muted-foreground">We couldn't find an appointment associated with this link. It may have expired or been cancelled.</p>
                </CardContent>
                 <CardFooter>
                    <Button className="w-full" onClick={() => router.push('/')}>Go to Homepage</Button>
                </CardFooter>
            </Card>
        );
    }

    const { appointment, client, service } = data;

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
                             <p className="text-sm text-muted-foreground">{format(new Date(appointment.startTime), 'EEEE, MMMM d')} at {format(new Date(appointment.startTime), 'h:mm a')}</p>
                        </div>
                    </div>
                    <div className="text-sm text-muted-foreground space-y-2 pt-3 border-t">
                        <div className="flex items-center gap-2"><Clock className="w-4 h-4"/> Duration: {service.duration} minutes</div>
                        <div className="flex items-center gap-2"><MapPin className="w-4 h-4"/> ClarityFlow Salon</div>
                    </div>
                </div>

                {status === 'pending' && (
                    <div className="grid grid-cols-2 gap-4">
                        <Button size="lg" onClick={handleRunningLate} variant="outline">Running Late?</Button>
                        <Button size="lg" onClick={handleOnMyWay}>
                            <Car className="mr-2" /> On My Way
                        </Button>
                    </div>
                )}

                {status === 'on_my_way' && (
                    <div className="space-y-4">
                        <div className="p-4 bg-green-500/10 text-green-700 dark:text-green-300 rounded-lg text-center">
                            <p className="font-semibold">Great! We'll see you soon.</p>
                        </div>
                        <Button size="lg" className="w-full" onClick={handleArrived}>
                            <Check className="mr-2" /> I've Arrived
                        </Button>
                    </div>
                )}

                {status === 'arrived' && (
                    <div className="p-4 bg-blue-500/10 text-blue-700 dark:text-blue-300 rounded-lg text-center">
                        <p className="font-semibold">You're checked in!</p>
                        <p className="text-sm">Please have a seat, we'll be with you shortly.</p>
                    </div>
                )}
                 
                 {status === 'running_late' && !showLateConfirm && (
                    <div className="space-y-4">
                         <h4 className="font-medium text-center">How late will you be?</h4>
                        <RadioGroup defaultValue="15" className="grid grid-cols-4 gap-2" onValueChange={(val) => setLateTime(parseInt(val))}>
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
                        <Button className="w-full" onClick={() => setShowLateConfirm(true)}>Confirm</Button>
                    </div>
                )}
                
                {status === 'running_late' && showLateConfirm && (
                     <div className="space-y-4 text-center">
                        <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive">
                             <AlertTriangle className="w-6 h-6 mx-auto mb-2"/>
                            <p className="font-semibold">Please Be Aware</p>
                            <p className="text-xs">Arrivals more than 15 minutes late may need to be rescheduled or have their service shortened. A late fee of $25.00 may apply.</p>
                        </div>
                        <p className="text-sm text-muted-foreground">You've indicated you'll be ~{lateTime} minutes late. Do you wish to proceed?</p>
                        <div className="grid grid-cols-2 gap-4">
                            <Button variant="outline" onClick={() => setStatus('pending')}>Cancel</Button>
                             <Button onClick={handleConfirmLate}>Yes, I Understand</Button>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
