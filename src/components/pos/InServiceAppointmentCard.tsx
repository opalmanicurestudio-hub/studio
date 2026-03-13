'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { type Appointment, type Service, Staff } from '@/lib/data';
import { parseISO, differenceInSeconds, differenceInMinutes } from 'date-fns';
import { User, Clock, CheckCircle, Undo2, Check, Hourglass, PlusCircle, Zap, Workflow, Cake, Square, Activity, Award, Repeat } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Progress } from '../ui/progress';
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

export const InServiceAppointmentCard: React.FC<any> = ({ appointment, services, staff, onSendToCheckout, onViewDetails }) => {
    const { clients } = useInventory();
    const mainService = services?.find((s:any) => s.id === appointment.serviceId);
    const addOnServices = (appointment.addOnIds || []).map((id:any) => services?.find((s:any) => s.id === id)).filter((s:any): s is Service => !!s);
    const allServices = [mainService, ...addOnServices].filter((s:any): s is Service => !!s);
    const serviceDuration = allServices.reduce((acc, s) => acc + s.duration, 0);

    const [elapsedTime, setElapsedTime] = useState<string | null>(null);
    const [isRunningOver, setIsRunningOver] = useState(false);
    const [progress, setProgress] = useState(0);
    const [minsRemaining, setMinsRemaining] = useState(0);

    const client = useMemo(() => clients?.find(c => c.id === appointment.clientId), [appointment.clientId, clients]);

    const isBirthdayToday = useMemo(() => {
        if (!client?.birthday) return false;
        const birth = safeDate(client.birthday);
        const today = new Date();
        return birth.getDate() === today.getDate() && birth.getMonth() === today.getMonth();
    }, [client]);

    const isMember = !!(client?.activeMembershipId || client?.subscription);
    const hasPackage = (client?.activePackages?.length || 0) > 0;

    useEffect(() => {
        let timer: NodeJS.Timeout | undefined;
        if (appointment.status === 'servicing' && appointment.actualStartTime) {
            const startTime = safeDate(appointment.actualStartTime);
            const updateTimer = () => {
                const diff = differenceInSeconds(new Date(), startTime);
                const minutes = Math.floor(diff / 60);
                const h = Math.floor(minutes / 60);
                const m = minutes % 60;
                const s = diff % 60;
                setElapsedTime(h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`);
                setIsRunningOver(minutes > serviceDuration);
                setMinsRemaining(Math.max(0, serviceDuration - minutes));
                if (serviceDuration > 0) setProgress(Math.min(100, (minutes / serviceDuration) * 100));
            };
            updateTimer(); 
            timer = setInterval(updateTimer, 1000);
        }
        return () => { if (timer) clearInterval(timer); };
    }, [appointment.status, appointment.actualStartTime, serviceDuration]);
    
    const assignedTechnicians = useMemo(() => {
        const techIds = new Set<string>();
        if (appointment.staffId) techIds.add(appointment.staffId);
        if (appointment.checkoutState?.serviceStaffOverrides) Object.values(appointment.checkoutState.serviceStaffOverrides).forEach((id: any) => techIds.add(id));
        return staff?.filter((s:any) => techIds.has(s.id)) || [];
    }, [appointment, staff]);

    const completedIds = appointment.checkoutState?.completedServiceIds || [];
    const concurrentIds = appointment.checkoutState?.concurrentServiceIds || [];
    const isReady = appointment.status === 'ready_for_checkout';
    
    return (
        <div className="h-full" onClick={onViewDetails}>
            <Card className={cn("transition-all border-2 rounded-2xl overflow-hidden shadow-sm h-full flex flex-col", isReady ? "border-green-500 bg-green-500/[0.03]" : "border-blue-500/20 bg-white", isRunningOver && "border-destructive ring-4 ring-destructive/10 shadow-destructive/10")}>
                <CardContent className="p-5 space-y-4 flex-1">
                    <div className="flex justify-between items-start gap-3 cursor-pointer">
                        <div className="space-y-4 flex-1 min-w-0 text-left">
                            <div className="flex items-center gap-2 flex-wrap">
                                {isBirthdayToday && <Cake className="h-3.5 w-3.5 text-pink-500 animate-bounce shrink-0" />}
                                <p className="font-black uppercase tracking-tight text-sm text-slate-900 truncate">{appointment.clientName}</p>
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
                            
                            <div className="space-y-2">
                                {assignedTechnicians.map(tech => {
                                    const techServices = Object.entries(appointment.checkoutState?.serviceStaffOverrides || {}).filter(([_, staffId]) => staffId === tech.id).map(([svcId]) => svcId);
                                    if (appointment.staffId === tech.id && !techServices.includes(appointment.serviceId)) techServices.unshift(appointment.serviceId);
                                    const isDone = techServices.length > 0 && techServices.every(id => completedIds.includes(id));
                                    const isWorking = techServices.some(svcId => {
                                        if (completedIds.includes(svcId)) return false;
                                        const primaryDone = completedIds.includes(appointment.serviceId);
                                        return (svcId === appointment.serviceId) || concurrentIds.includes(svcId) || primaryDone;
                                    });
                                    return (
                                        <div key={tech.id} className={cn("flex items-center gap-2 p-2 rounded-xl border-2 bg-background transition-all", isDone && "opacity-40 grayscale")}>
                                            <Avatar className="h-7 w-7 border shadow-sm rounded-lg"><AvatarImage src={tech.avatarUrl} className="object-cover" /><AvatarFallback className="font-black text-[9px] uppercase">{(tech.name||'S')[0]}</AvatarFallback></Avatar>
                                            <div className="min-w-0 flex-1 text-left">
                                                <p className="text-[10px] font-black uppercase tracking-tight truncate leading-tight">{tech.name.split(' ')[0]}</p>
                                                <div className="flex items-center gap-1.5 mt-0.5">
                                                    {techServices.map(sid => {
                                                        const isCon = concurrentIds.includes(sid);
                                                        return (
                                                            <TooltipProvider key={sid}>
                                                                <Tooltip>
                                                                    <TooltipTrigger>{isCon ? <Zap className="w-2.5 h-2.5 text-primary" /> : <Workflow className="w-2.5 h-2.5 text-muted-foreground opacity-40" />}</TooltipTrigger>
                                                                    <TooltipContent className="rounded-xl border-2 font-black uppercase text-[9px] tracking-widest">{services?.find((s: Service) => s.id === sid)?.name} ({isCon ? 'Concurrent' : 'Turn'})</TooltipContent>
                                                                </Tooltip>
                                                            </TooltipProvider>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                            {isDone ? <Check className="w-4 h-4 text-green-500" /> : isWorking ? <Badge className="bg-primary text-white border-none h-4 px-1 text-[8px] font-black uppercase animate-pulse">Live</Badge> : <Badge variant="secondary" className="h-4 px-1 text-[8px] uppercase font-black bg-muted border-none opacity-40">Wait</Badge>}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                        <div className="text-right shrink-0">
                            {allServices?.slice(0, 2).map(s => <div key={s.id} className="flex items-center justify-end gap-1">{completedIds.includes(s.id) && <Check className="w-2.5 h-2.5 text-green-500" />}<p className={cn("text-[9px] font-black uppercase tracking-widest", completedIds.includes(s.id) ? "text-muted-foreground line-through opacity-40" : "text-slate-900")}>{s.name}</p></div>)}
                            {elapsedTime && <p className={cn("text-2xl font-black font-mono tracking-tighter mt-3", isRunningOver ? "text-destructive" : "text-primary")}>{elapsedTime}</p>}
                        </div>
                    </div>
                    {elapsedTime && (
                        <div className="mt-4 space-y-1.5">
                            <Progress value={progress} className={cn("h-1.5 rounded-full bg-muted", isRunningOver && "[&>div]:bg-destructive")} />
                            <div className="flex justify-between items-center text-[8px] font-black uppercase tracking-widest text-muted-foreground opacity-60">
                                <span>{isRunningOver ? "OVERTIME ALERT" : `~${minsRemaining}M REMAINING`}</span>
                                <span>{serviceDuration}M GOAL</span>
                            </div>
                        </div>
                    )}
                </CardContent>
                
                <div className="p-2 pt-0 grid grid-cols-1 gap-2">
                    <Button size="sm" className="w-full h-12 rounded-xl font-black uppercase text-xs tracking-[0.2em] shadow-xl shadow-primary/20" onClick={(e) => { e.stopPropagation(); onSendToCheckout(); }} disabled={isReady}>
                        <Square className="w-4 h-4 mr-2" />
                        Finish & Checkout
                    </Button>
                </div>
            </Card>
        </div>
    );
};