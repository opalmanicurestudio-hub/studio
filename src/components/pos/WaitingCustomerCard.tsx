
'use client';

import React from 'react';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { type WalkIn, type Service } from '@/lib/data';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { User, Clock, UserPlus, Play } from 'lucide-react';

interface WaitingCustomerCardProps {
    walkIn: WalkIn;
    services: Service[] | null;
    onAssign: () => void;
    onStart: () => void;
}

export const WaitingCustomerCard: React.FC<WaitingCustomerCardProps> = ({ walkIn, services, onAssign, onStart }) => {
    const selectedServices = services?.filter(s => walkIn.serviceIds.includes(s.id));
    const waitTime = formatDistanceToNow(parseISO(walkIn.checkInTime), { addSuffix: true });

    return (
        <Card>
            <CardContent className="p-4">
                <div className="flex justify-between items-start">
                    <div>
                        <p className="font-semibold flex items-center gap-2"><User className="w-4 h-4"/>{walkIn.customerName}</p>
                        <p className="text-sm text-muted-foreground flex items-center gap-2"><Clock className="w-4 h-4"/>Waiting {waitTime}</p>
                    </div>
                     <div className="text-right">
                        {selectedServices?.map(s => <p key={s.id} className="text-sm">{s.name}</p>)}
                        <p className="text-xs text-muted-foreground">{walkIn.estimatedDuration} min</p>
                    </div>
                </div>
            </CardContent>
            <CardFooter className="p-2 border-t grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={onAssign}><UserPlus className="w-4 h-4 mr-2" />Assign</Button>
                <Button onClick={onStart} disabled={!walkIn.assignedStaffId}><Play className="w-4 h-4 mr-2" />Start</Button>
            </CardFooter>
        </Card>
    );
};
