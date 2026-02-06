'use client';

import React from 'react';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { type Appointment, type Service, type Staff } from '@/lib/data';
import { formatDistanceToNow, parseISO, addMinutes } from 'date-fns';
import { User, Clock, CheckCircle } from 'lucide-react';

interface InServiceAppointmentCardProps {
    appointment: Appointment;
    services: Service[] | null;
    staff: Staff[] | null;
    onSendToCheckout: () => void;
}

export const InServiceAppointmentCard: React.FC<InServiceAppointmentCardProps> = ({ appointment, services, staff, onSendToCheckout }) => {
    const mainService = services?.find(s => s.id === appointment.serviceId);
    const addOnServices = (appointment.addOnIds || []).map(id => services?.find(s => s.id === id));
    const allServices = [mainService, ...addOnServices].filter(Boolean) as Service[];

    const assignedStaff = staff?.find(s => s.id === appointment.staffId);
    
    const serviceDuration = allServices.reduce((acc, s) => acc + s.duration, 0);

    const endTime = appointment.actualStartTime ? addMinutes(parseISO(appointment.actualStartTime as string), serviceDuration) : null;
    const isReady = appointment.status === 'ready_for_checkout';
    
    return (
        <Card className={isReady ? "border-green-500" : ""}>
            <CardContent className="p-4">
                 <div className="flex justify-between items-start">
                    <div>
                        <p className="font-semibold flex items-center gap-2"><User className="w-4 h-4"/>{appointment.clientName}</p>
                        <p className="text-sm text-muted-foreground flex items-center gap-2"><Clock className="w-4 h-4"/>With {assignedStaff?.name || 'N/A'}</p>
                    </div>
                     <div className="text-right">
                        {allServices?.map(s => <p key={s.id} className="text-sm">{s.name}</p>)}
                        {endTime && <p className="text-xs text-muted-foreground">Ends ~{formatDistanceToNow(endTime, { addSuffix: true })}</p>}
                    </div>
                </div>
            </CardContent>
             <CardFooter className="p-2 border-t">
                <Button className="w-full" onClick={onSendToCheckout} disabled={isReady}>
                    <CheckCircle className="w-4 h-4 mr-2" />
                    {isReady ? "Ready for Checkout" : "Send to Checkout"}
                </Button>
            </CardFooter>
        </Card>
    );
};
