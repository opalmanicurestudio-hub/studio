'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { type WalkIn, type Service, Staff } from '@/lib/data';
import { parseISO, differenceInMinutes } from 'date-fns';
import { 
    Clock, 
    SkipForward, 
    Play, 
    XCircle, 
    Users, 
    Undo2, 
    Cake,
    Award,
    Repeat
} from 'lucide-react';
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
    return new Date(val);
};

export const NotifiedCustomerCard: React.FC<any> = ({ walkIn, staff, onStartService, onSkip, onCancel, onReturnToQueue }) => {
    const { selectedTenant } = useTenant();
    const { clients } = useInventory();
    const [timeSinceNotified, setTimeSinceNotified] = useState('');
    const [isOverTime, setIsOverTime] = useState(false);
    
    useEffect(() => {
        if (walkIn.notifiedTimestamp) {
            const updateTimer = () => {
                const notifiedAt = parseISO(walkIn.notifiedTimestamp as string);
                const minutes = Math.floor(differenceInMinutes(new Date(), notifiedAt));
                setTimeSinceNotified(`${minutes}m`);
                if (selectedTenant?.queueSkipTimeMinutes && minutes > selectedTenant.queueSkipTimeMinutes) setIsOverTime(true);
            };
            updateTimer();
            const interval = setInterval(updateTimer, 30000);
            return () => clearInterval(interval);
        }
    }, [walkIn.notifiedTimestamp, selectedTenant]);

    const client = useMemo(() => clients?.find(c => c.id === walkIn.clientId), [walkIn.clientId, clients]);

    const isBirthdayToday = useMemo(() => {
        if (!client?.birthday) return false;
        const birth = safeDate(client.birthday);
        const today = new Date();
        return birth.getDate() === today.getDate() && birth.getMonth() === today.getMonth();
    }, [client]);

    const isMember = !!(client?.activeMembershipId || client?.subscription);
    const hasPackage = (client?.activePackages?.length || 0) > 0;

    const assignedStaff = staff?.find((s:any) => s.id === walkIn.assignedStaffId);
    if (!assignedStaff) return null;

    return (
        <Card className={cn(
            "transition-all border-4 rounded-2xl overflow-hidden shadow-sm",
            isOverTime ? "border-destructive bg-destructive/[0.03] animate-pulse" : "border-green-500/20 bg-white"
        )}>
            <CardContent className="p-5 space-y-4">
                <div className="flex justify-between items-start gap-4">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap text-left">
                            {isBirthdayToday && <Cake className="h-3.5 w-3.5 text-pink-500 animate-bounce shrink-0" />}
                            <p className="font-black uppercase tracking-tight text-sm text-slate-900 truncate">{walkIn.customerName}</p>
                            {isMember && (
                                <Badge className="bg-indigo-600 text-white border-none text-[7px] font-black uppercase h-4 px-1.5 shadow-sm">
                                    <Award className="w-2 h-2 mr-0.5" /> MEM
                                </Badge>
                            )}
                            {hasPackage && (
                                <Badge className="bg-teal-600 text-white border-none text-[7px] font-black uppercase h-4 px-1.5 shadow-sm">
                                    <Repeat className="w-2 h-2 mr-0.5" /> PKG
                                </Badge>
                            )}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                            <Badge variant="outline" className="bg-green-100 text-green-800 border-green-200 text-[9px] font-black uppercase h-5">Notified {timeSinceNotified} ago</Badge>
                            {isOverTime && <Badge variant="destructive" className="animate-pulse h-5 text-[9px] uppercase font-black">CRITICAL: SKIP READY</Badge>}
                        </div>
                        
                        <div className="flex items-center gap-2 mt-4 p-2 rounded-xl bg-primary/5 border-2 border-primary/10 w-fit">
                            <Avatar className="h-7 w-7 border-2 border-background shadow-inner rounded-lg">
                                <AvatarImage src={assignedStaff.avatarUrl} className="object-cover" />
                                <AvatarFallback className="text-[9px] font-black">{(assignedStaff.name || 'S').charAt(0)}</AvatarFallback>
                            </Avatar>
                            <div className="min-w-0 pr-2">
                                <p className="text-[8px] font-black uppercase text-muted-foreground leading-none mb-0.5">Professional</p>
                                <p className="text-[11px] font-black text-primary uppercase tracking-tight truncate">{assignedStaff.name.split(' ')[0]}</p>
                            </div>
                        </div>
                    </div>
                </div>
            </CardContent>
            
            <div className="p-2 pt-0 grid grid-cols-1 gap-2">
                <Button size="sm" className="w-full h-12 rounded-xl font-black uppercase text-xs tracking-[0.2em] shadow-xl shadow-primary/20" onClick={() => onStartService(walkIn.id)}>
                    <Play className="w-4 h-4 mr-2" /> Start Session
                </Button>
                
                <div className="grid grid-cols-3 gap-2">
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="outline" size="sm" className="h-10 rounded-lg border-2" onClick={() => onReturnToQueue(walkIn.id)}>
                                    <Users className="w-4 h-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent className="font-black uppercase text-[10px]">Return to Queue</TooltipContent>
                        </Tooltip>

                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="outline" size="sm" className="h-10 rounded-lg border-2 text-amber-600 hover:bg-amber-50" onClick={() => onSkip(walkIn.id)}>
                                    <SkipForward className="w-4 h-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent className="font-black uppercase text-[10px]">Mark No-Show</TooltipContent>
                        </Tooltip>

                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="outline" size="sm" className="h-10 rounded-lg border-2 text-destructive hover:bg-destructive/5" onClick={() => onCancel(walkIn.id)}>
                                    <XCircle className="w-4 h-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent className="font-black uppercase text-[10px]">Terminate Walk-in</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
            </div>
        </Card>
    );
};