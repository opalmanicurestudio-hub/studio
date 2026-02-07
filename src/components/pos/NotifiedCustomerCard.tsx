

'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { type WalkIn, type Service, type Staff } from '@/lib/data';
import { formatDistanceToNow, parseISO, differenceInMinutes } from 'date-fns';
import { User, Clock, CheckCircle, SkipForward, Play, XCircle, MoreHorizontal, Users } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { useTenant } from '@/context/TenantContext';
import { cn } from '@/lib/utils';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '../ui/dropdown-menu';

interface NotifiedCustomerCardProps {
    walkIn: WalkIn;
    services: Service[] | null;
    staff: Staff[] | null;
    onStartService: (appointmentId: string) => void;
    onSkip: (walkInId: string) => void;
    onCancel: (walkInId: string) => void;
    onReturnToQueue: (walkInId: string) => void;
}

export const NotifiedCustomerCard: React.FC<NotifiedCustomerCardProps> = ({ walkIn, services, staff, onStartService, onSkip, onCancel, onReturnToQueue }) => {
    const { selectedTenant } = useTenant();
    const [timeSinceNotified, setTimeSinceNotified] = useState('');
    const [isOverTime, setIsOverTime] = useState(false);
    
    useEffect(() => {
        if (walkIn.notifiedTimestamp) {
            const updateTimer = () => {
                const notifiedAt = parseISO(walkIn.notifiedTimestamp as string);
                const minutes = Math.floor(differenceInMinutes(new Date(), notifiedAt));
                setTimeSinceNotified(`${minutes} min ago`);

                if (selectedTenant?.queueSkipTimeMinutes && minutes > selectedTenant.queueSkipTimeMinutes) {
                    setIsOverTime(true);
                }
            };
            updateTimer();
            const interval = setInterval(updateTimer, 30000); // update every 30 seconds
            return () => clearInterval(interval);
        }
    }, [walkIn.notifiedTimestamp, selectedTenant]);


    const assignedStaff = staff?.find(s => s.id === walkIn.assignedStaffId);
    
    if (!assignedStaff) return null; // Should not happen for notified clients

    return (
        <Card className={cn(isOverTime && 'border-destructive ring-2 ring-destructive')}>
            <CardContent className="p-4 space-y-3">
                <div className="flex items-start gap-4">
                    <Avatar className="w-12 h-12">
                        <AvatarFallback>{walkIn.customerName.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                        <p className="font-semibold">{walkIn.customerName}</p>
                        <p className="text-xs text-muted-foreground">Notified {timeSinceNotified}</p>
                         <p className="text-sm mt-1">Assigned to: <span className="font-semibold">{assignedStaff.name}</span></p>
                    </div>
                </div>
                {isOverTime && (
                    <div className="p-2 text-xs text-center bg-destructive/10 text-destructive rounded-md">
                        Past skip time of {selectedTenant?.queueSkipTimeMinutes} minutes.
                    </div>
                )}
            </CardContent>
            <CardFooter className="p-2 grid grid-cols-[1fr,auto] gap-2 border-t">
                <Button size="sm" onClick={() => onStartService(`apt-walkin-${walkIn.id}`)}>
                    <Play className="w-4 h-4 mr-2" /> Start Service
                </Button>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onReturnToQueue(walkIn.id)}>
                            <Users className="w-4 h-4 mr-2" /> Return to Queue
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onSkip(walkIn.id)}>
                            <SkipForward className="w-4 h-4 mr-2" /> Skip (No-Show)
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive" onClick={() => onCancel(walkIn.id)}>
                            <XCircle className="w-4 h-4 mr-2" /> Cancel Walk-in
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </CardFooter>
        </Card>
    );
};
