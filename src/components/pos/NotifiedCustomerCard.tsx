'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { type WalkIn, type Service, Staff } from '@/lib/data';
import { parseISO, differenceInMinutes } from 'date-fns';
import { Clock, SkipForward, Play, XCircle, Users, AlertTriangle, Cake, Undo2, MoreHorizontal } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { useTenant } from '@/context/TenantContext';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { useInventory } from '@/context/InventoryContext';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu';

export const NotifiedCustomerCard: React.FC<any> = ({ walkIn, services, staff, onStartService, onSkip, onCancel, onReturnToQueue }) => {
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

    const isBirthdayToday = useMemo(() => {
        const client = clients?.find(c => c.id === walkIn.clientId);
        if (!client?.birthday) return false;
        const today = new Date();
        const birth = new Date(client.birthday);
        return birth.getMonth() === today.getMonth() && birth.getDate() === today.getDate();
    }, [walkIn.clientId, clients]);

    const assignedStaff = staff?.find((s:any) => s.id === walkIn.assignedStaffId);
    if (!assignedStaff) return null;

    return (
        <Card className={cn(
            "transition-all border-4 rounded-2xl overflow-hidden shadow-sm",
            isOverTime ? "border-destructive bg-destructive/[0.03] animate-pulse" : "border-green-500/20 bg-white"
        )}>
            <CardContent className="p-5 space-y-4">
                <div className="flex items-start gap-4">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                            <p className="font-black uppercase tracking-tight text-sm text-slate-900 truncate">{walkIn.customerName}</p>
                            {isBirthdayToday && <Badge className="bg-pink-500 text-white border-none text-[8px] h-4 font-black uppercase"><Cake className="w-2.5 h-2.5 mr-1" /> B-Day</Badge>}
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
            <CardFooter className="p-2 flex items-center gap-2 border-t bg-muted/5">
                <Button size="sm" className="flex-1 h-11 rounded-xl font-black uppercase text-[11px] tracking-[0.2em] shadow-xl shadow-primary/20" onClick={() => onStartService(walkIn.id)}>
                    <Play className="w-4 h-4 mr-2" /> Start Session
                </Button>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-11 w-11 rounded-xl"><MoreHorizontal className="h-5 w-5"/></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="rounded-2xl border-2 shadow-2xl">
                        <DropdownMenuItem onClick={() => onReturnToQueue(walkIn.id)} className="font-bold text-[10px] uppercase tracking-widest"><Users className="w-3.5 h-3.5 mr-2" /> Return to Queue</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onSkip(walkIn.id)} className="text-amber-600 font-bold text-[10px] uppercase tracking-widest"><SkipForward className="w-3.5 h-3.5 mr-2" /> Mark as No-Show</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onCancel(walkIn.id)} className="text-destructive font-bold text-[10px] uppercase tracking-widest"><XCircle className="w-3.5 h-3.5 mr-2" /> Terminate Walk-in</DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </CardFooter>
        </Card>
    );
};