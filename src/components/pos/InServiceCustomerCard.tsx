
'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { type Appointment, type Service, type Staff } from '@/lib/data';
import { formatDistanceToNow, parseISO, addMinutes, differenceInSeconds } from 'date-fns';
import { User, Clock, CheckCircle } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Progress } from '../ui/progress';
import { cn } from '@/lib/utils';

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

    const [elapsedTime, setElapsedTime] = useState<string | null>(null);
    const [isRunningOver, setIsRunningOver] = useState(false);
    const [progress, setProgress] = useState(0);

    useEffect(() => {
        let timer: NodeJS.Timeout | undefined;

        if (appointment.status === 'servicing' && appointment.actualStartTime) {
            const startTime = typeof appointment.actualStartTime === 'string'
                ? parseISO(appointment.actualStartTime)
                : appointment.actualStartTime;

            const updateTimer = () => {
                const now = new Date();
                const diffInSeconds = differenceInSeconds(now, startTime);

                const hours = Math.floor(diffInSeconds / 3600);
                const minutes = Math.floor((diffInSeconds % 3600) / 60);
                const seconds = diffInSeconds % 60;

                if (hours > 0) {
                    setElapsedTime(`${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`);
                } else {
                    setElapsedTime(`${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`);
                }

                const elapsedMinutes = Math.floor(diffInSeconds / 60);
                setIsRunningOver(elapsedMinutes > serviceDuration);

                if (serviceDuration > 0) {
                    setProgress(Math.min(100, (elapsedMinutes / serviceDuration) * 100));
                }
            };
            
            updateTimer(); // Initial call
            timer = setInterval(updateTimer, 1000);
        } else {
            setElapsedTime(null);
            setIsRunningOver(false);
            setProgress(0);
        }

        return () => {
            if (timer) {
                clearInterval(timer);
            }
        };
    }, [appointment.status, appointment.actualStartTime, serviceDuration]);
    
    const endTime = appointment.actualStartTime ? addMinutes(typeof appointment.actualStartTime === 'string' ? parseISO(appointment.actualStartTime) : appointment.actualStartTime, serviceDuration) : null;
    const isReady = appointment.status === 'ready_for_checkout';
    
    return (
        <Card className={cn(isReady ? "border-green-500" : "", isRunningOver && "border-destructive ring-2 ring-destructive/50")}>
            <CardContent className="p-4">
                 <div className="flex justify-between items-start">
                    <div className="space-y-2">
                        <p className="font-semibold flex items-center gap-2"><User className="w-4 h-4"/>{appointment.clientName}</p>
                        <div className="flex items-center gap-2">
                          <Avatar className="w-6 h-6">
                            <AvatarImage src={assignedStaff?.avatarUrl} alt={assignedStaff?.name || ''} />
                            <AvatarFallback>{assignedStaff?.name.charAt(0) || '?'}</AvatarFallback>
                          </Avatar>
                          <span className="text-sm text-muted-foreground">With {assignedStaff?.name || 'N/A'}</span>
                        </div>
                    </div>
                     <div className="text-right">
                        {allServices?.map(s => <p key={s.id} className="text-sm">{s.name}</p>)}
                        {endTime && !elapsedTime && <p className="text-xs text-muted-foreground">Ends ~{formatDistanceToNow(endTime, { addSuffix: true })}</p>}
                        {elapsedTime && <p className={cn("text-xl font-bold font-mono", isRunningOver && "text-destructive")}>{elapsedTime}</p>}
                    </div>
                </div>
                {elapsedTime && (
                    <div className="mt-3 space-y-1">
                        <Progress value={progress} className={cn("h-1.5", isRunningOver && "[&>div]:bg-destructive")} />
                        <p className="text-xs text-muted-foreground text-right">{serviceDuration} min scheduled</p>
                    </div>
                )}
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
