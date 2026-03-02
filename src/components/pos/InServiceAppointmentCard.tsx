'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { type Appointment, type Service, type Staff } from '@/lib/data';
import { formatDistanceToNow, parseISO, addMinutes, differenceInSeconds } from 'date-fns';
import { User, Clock, CheckCircle, MoreHorizontal, Undo2, Check, Hourglass, PlusCircle } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Progress } from '../ui/progress';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { Badge } from '@/components/ui/badge';

interface InServiceAppointmentCardProps {
    appointment: Appointment;
    services: Service[] | null;
    staff: Staff[] | null;
    onSendToCheckout: () => void;
    onRevertToReady: () => void;
    onViewDetails: () => void;
}

export const InServiceAppointmentCard: React.FC<InServiceAppointmentCardProps> = ({ 
    appointment, 
    services, 
    staff, 
    onSendToCheckout,
    onRevertToReady,
    onViewDetails
}) => {
    const mainService = services?.find(s => s.id === appointment.serviceId);
    const addOnServices = (appointment.addOnIds || []).map(id => services?.find(s => s.id === id)).filter((s): s is Service => !!s);
    const allServices = [mainService, ...addOnServices].filter((s): s is Service => !!s);

    const serviceDuration = allServices.reduce((acc, s) => acc + s.duration, 0);

    const [elapsedTime, setElapsedTime] = useState<string | null>(null);
    const [isRunningOver, setIsRunningOver] = useState(false);
    const [progress, setProgress] = useState(0);

    const safeDate = (val: any): Date => {
        if (!val) return new Date();
        if (val instanceof Date) return val;
        if (typeof val?.toDate === 'function') return val.toDate();
        if (typeof val === 'string') return parseISO(val);
        if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
        return new Date(val);
    };

    useEffect(() => {
        let timer: NodeJS.Timeout | undefined;

        if (appointment.status === 'servicing' && appointment.actualStartTime) {
            const startTime = safeDate(appointment.actualStartTime);

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
            
            updateTimer(); 
            timer = setInterval(updateTimer, 1000);
        }
        return () => { if (timer) clearInterval(timer); };
    }, [appointment.status, appointment.actualStartTime, serviceDuration]);
    
    const assignedTechnicians = useMemo(() => {
        const techIds = new Set<string>();
        if (appointment.staffId) techIds.add(appointment.staffId);
        if (appointment.checkoutState?.serviceStaffOverrides) {
            Object.values(appointment.checkoutState.serviceStaffOverrides).forEach(id => techIds.add(id));
        }
        return staff?.filter(s => techIds.has(s.id)) || [];
    }, [appointment, staff]);

    const completedIds = appointment.checkoutState?.completedServiceIds || [];
    const concurrentIds = appointment.checkoutState?.concurrentServiceIds || [];
    const isReady = appointment.status === 'ready_for_checkout';
    
    return (
        <Card className={cn("transition-all border-2", isReady ? "border-green-500 bg-green-500/[0.02]" : "", isRunningOver && "border-destructive ring-2 ring-destructive/50")}>
            <CardContent className="p-4" onClick={onViewDetails}>
                 <div className="flex justify-between items-start gap-2 cursor-pointer">
                    <div className="space-y-3 flex-1 min-w-0">
                        <p className="font-bold flex items-center gap-2 truncate text-sm"><User className="w-4 h-4 shrink-0"/>{appointment.clientName}</p>
                        
                        <div className="space-y-1.5">
                            <p className="text-[9px] font-black uppercase text-muted-foreground tracking-widest mb-1">Active Providers</p>
                            {assignedTechnicians.map(tech => {
                                const techServices = Object.entries(appointment.checkoutState?.serviceStaffOverrides || {})
                                    .filter(([_, staffId]) => staffId === tech.id)
                                    .map(([svcId]) => svcId);
                                if (appointment.staffId === tech.id && !techServices.includes(appointment.serviceId)) {
                                    techServices.unshift(appointment.serviceId);
                                }
                                
                                const isDone = techServices.length > 0 && techServices.every(id => completedIds.includes(id));
                                
                                const isWorking = techServices.some(svcId => {
                                    if (completedIds.includes(svcId)) return false;
                                    const isPrimary = svcId === appointment.serviceId;
                                    const isConcurrent = concurrentIds.includes(svcId);
                                    const prevPartDone = completedIds.includes(appointment.serviceId);
                                    return isPrimary || isConcurrent || prevPartDone;
                                });

                                return (
                                    <div key={tech.id} className={cn("flex items-center gap-2 p-1 rounded-lg border bg-background transition-opacity", isDone && "opacity-50 grayscale")}>
                                        <Avatar className="h-6 w-6 border shadow-inner">
                                            <AvatarImage src={tech.avatarUrl} className="object-cover" />
                                            <AvatarFallback>{tech.name.charAt(0)}</AvatarFallback>
                                        </Avatar>
                                        <span className="text-[11px] font-bold truncate flex-1">{tech.name.split(' ')[0]}</span>
                                        {isDone ? (
                                            <Badge className="bg-green-500 border-none h-4 px-1 text-[8px] uppercase font-black text-white">Done</Badge>
                                        ) : isWorking ? (
                                            <Badge variant="outline" className="h-4 px-1 text-[8px] uppercase font-black animate-pulse border-primary text-primary">Working</Badge>
                                        ) : (
                                            <Badge variant="secondary" className="h-4 px-1 text-[8px] uppercase font-black bg-muted text-muted-foreground border-none">
                                                <Hourglass className="w-2 h-2 mr-0.5" />
                                                Queued
                                            </Badge>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                     <div className="text-right shrink-0">
                        {allServices?.slice(0, 2).map(s => (
                            <div key={s.id} className="flex items-center justify-end gap-1">
                                {completedIds.includes(s.id) && <Check className="w-2.5 h-2.5 text-green-500" />}
                                <p className={cn("text-[10px] font-bold leading-tight", completedIds.includes(s.id) && "text-muted-foreground line-through")}>{s.name}</p>
                            </div>
                        ))}
                        {allServices.length > 2 && <p className="text-[9px] text-muted-foreground">+{allServices.length - 2} more</p>}
                        {elapsedTime && <p className={cn("text-xl font-black font-mono tracking-tighter mt-2", isRunningOver && "text-destructive")}>{elapsedTime}</p>}
                    </div>
                </div>
                {elapsedTime && (
                    <div className="mt-3 space-y-1">
                        <Progress value={progress} className={cn("h-1.5", isRunningOver && "[&>div]:bg-destructive")} />
                        <p className="text-[9px] text-muted-foreground text-right uppercase font-black">{serviceDuration}m scheduled</p>
                    </div>
                )}
            </CardContent>
             <CardFooter className="p-2 border-t gap-2 bg-muted/30">
                <Button variant="secondary" size="sm" className="flex-1 font-bold h-9" onClick={onSendToCheckout} disabled={isReady}>
                    <CheckCircle className="w-4 h-4 mr-2" />
                    {isReady ? "Ready for Checkout" : "Send to Desk"}
                </Button>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-9 w-9">
                            <MoreHorizontal className="h-4 w-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={onViewDetails}>
                            <PlusCircle className="w-4 h-4 mr-2" />
                            Add-ons / Assignments
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={onRevertToReady} className="text-muted-foreground">
                            <Undo2 className="w-4 h-4 mr-2" />
                            Revert to Notified
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </CardFooter>
        </Card>
    );
};