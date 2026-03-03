'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { type WalkIn, type Service, type Staff } from '@/lib/data';
import { formatDistanceToNow, parseISO, differenceInMinutes } from 'date-fns';
import { User, Clock, CheckCircle, SkipForward, Play, XCircle, MoreHorizontal, Users, AlertTriangle, Cake } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { useTenant } from '@/context/TenantContext';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { useInventory } from '@/context/InventoryContext';

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val?.toDate === 'function') return val.toDate();
    if (typeof val === 'string') return parseISO(val);
    if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
    return new Date(val);
};

interface NotifiedCustomerCardProps {
    walkIn: WalkIn;
    services: Service[] | null;
    staff: Staff[] | null;
    onStartService: (walkInId: string) => void;
    onSkip: (walkInId: string) => void;
    onCancel: (walkInId: string) => void;
    onReturnToQueue: (walkInId: string) => void;
}

export const NotifiedCustomerCard: React.FC<NotifiedCustomerCardProps> = ({ walkIn, services, staff, onStartService, onSkip, onCancel, onReturnToQueue }) => {
    const { selectedTenant } = useTenant();
    const { clients } = useInventory();
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

    const isBirthdayToday = useMemo(() => {
        const client = clients?.find(c => c.id === walkIn.clientId);
        if (!client?.birthday) return false;
        const birth = safeDate(client.birthday);
        const today = new Date();
        return birth.getMonth() === today.getMonth() && birth.getDate() === today.getDate();
    }, [walkIn.clientId, clients]);


    const assignedStaff = staff?.find(s => s.id === walkIn.assignedStaffId);
    
    if (!assignedStaff) return null;

    return (
        <Card className={cn(isOverTime && 'border-destructive ring-2 ring-destructive')}>
            <CardContent className="p-4 space-y-3">
                <div className="flex items-start gap-4">
                    <Avatar className="w-12 h-12 border shadow-sm">
                        <AvatarFallback className="bg-muted text-muted-foreground font-bold">
                            {walkIn.customerName.charAt(0)}
                        </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                            <p className="font-bold truncate text-sm">{walkIn.customerName}</p>
                            {isBirthdayToday && <Badge className="bg-pink-500 text-white border-none text-[8px] h-4 px-1 uppercase font-black shadow-sm animate-bounce"><Cake className="w-2 h-2 mr-0.5" /> Birthday</Badge>}
                        </div>
                        <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Notified {timeSinceNotified}</p>
                        
                        <div className="flex items-center gap-2 mt-2 p-1.5 rounded-lg bg-primary/5 border border-primary/10 w-fit">
                            <Avatar className="h-6 w-6 border border-background shadow-inner">
                                <AvatarImage src={assignedStaff.avatarUrl} className="object-cover" />
                                <AvatarFallback className="text-[8px]">{assignedStaff.name.charAt(0)}</AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                                <p className="text-[9px] font-black uppercase text-muted-foreground leading-none">Assigned To</p>
                                <p className="text-[11px] font-bold text-primary truncate">{assignedStaff.name}</p>
                            </div>
                        </div>
                    </div>
                </div>
                {isOverTime && (
                    <div className="p-2 text-[10px] font-black uppercase text-center bg-destructive/10 text-destructive rounded-lg border border-destructive/20 animate-pulse">
                        <AlertTriangle className="inline-block w-3 h-3 mr-1" />
                        Past skip time ({selectedTenant?.queueSkipTimeMinutes}m)
                    </div>
                )}
            </CardContent>
            <CardFooter className="p-2 flex items-center gap-2 border-t bg-muted/30">
                <Button size="sm" className="flex-1 font-bold h-9" onClick={() => onStartService(walkIn.id)}>
                    <Play className="w-4 h-4 mr-2" /> Start
                </Button>
                <TooltipProvider>
                    <div className="flex items-center">
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => onReturnToQueue(walkIn.id)}>
                                    <Users className="w-4 h-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent><p>Return to Queue</p></TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => onSkip(walkIn.id)}>
                                    <SkipForward className="w-4 h-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent><p>Skip (No-Show)</p></TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive" onClick={() => onCancel(walkIn.id)}>
                                    <XCircle className="w-4 h-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent><p>Cancel Walk-in</p></TooltipContent>
                        </Tooltip>
                    </div>
                </TooltipProvider>
            </CardFooter>
        </Card>
    );
};