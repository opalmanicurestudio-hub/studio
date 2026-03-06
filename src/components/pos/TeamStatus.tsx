'use client';

import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { type Staff, type Appointment, type Service, type Resource } from '@/lib/data';
import { cn } from '@/lib/utils';
import { Clock, MoreHorizontal, ArrowUp, ArrowDown, MapPin, Car, HardHat, Building, RefreshCw, Sparkles, Users, Zap, Workflow } from 'lucide-react';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { format, differenceInMinutes, parseISO, isSameDay, startOfDay } from 'date-fns';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../ui/select';
import { useTenant } from '@/context/TenantContext';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '../ui/tooltip';

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val?.toDate === 'function') return val.toDate();
    if (typeof val === 'string') return parseISO(val);
    if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
    return new Date(val);
};

const StaffMemberCard = ({ 
    member, 
    isNextUp, 
    turnOrder, 
    onMoveUp, 
    onMoveDown, 
    isFirst, 
    isLast, 
    assignmentMode,
    nextAppointment,
    onForceIdle,
    canManage,
    services
}: { 
    member: Staff & { availability?: { status: string } }, 
    isNextUp: boolean, 
    turnOrder: number | null, 
    onMoveUp: (id: string) => void,
    onMoveDown: (id: string) => void,
    isFirst: boolean,
    isLast: boolean,
    assignmentMode: 'fair_play' | 'ordered_list',
    nextAppointment?: Appointment | null,
    onForceIdle: (id: string) => void,
    canManage: boolean,
    services: Service[] | null
}) => {
    const getStatus = () => {
        if (!member.active) return { text: 'Offline', className: 'bg-muted text-muted-foreground' };
        if (member.onBreak) return { text: 'On Break', className: 'bg-amber-500 text-white border-none' };
        if (member.status === 'busy') return { text: 'Busy', className: 'bg-destructive text-white border-none' };
        return { text: 'Idle', className: 'bg-green-500 text-white border-none' };
    };

    const status = getStatus();
    const initials = (member.name || 'S').split(' ').map((n: string) => n[0]).join('').toUpperCase().substring(0, 2);

    return (
        <Card className={cn(
            "relative transition-all border-2 rounded-[2rem] flex flex-col h-full",
            isNextUp ? "border-primary ring-4 ring-primary/10 shadow-2xl scale-[1.02] z-10" : "border-border/50 shadow-sm",
            !member.active && "opacity-40 grayscale"
        )}>
            {assignmentMode === 'ordered_list' && member.active && (
                <div className="absolute top-3 left-3 z-20 w-7 h-7 rounded-xl bg-primary text-primary-foreground font-black text-[11px] flex items-center justify-center border-2 border-background shadow-lg">
                    {turnOrder}
                </div>
            )}

            <CardContent className={cn("p-5 flex flex-col gap-4 flex-1", assignmentMode === 'ordered_list' && member.active && "pt-12")}>
                <div className="flex items-start justify-between gap-3">
                    <div className="relative shrink-0">
                        <Avatar className="w-14 h-14 border-2 border-background shadow-xl rounded-2xl">
                            <AvatarImage src={member.avatarUrl} alt={member.name} className="object-cover" />
                            <AvatarFallback className="font-black bg-muted text-muted-foreground text-xs">{initials}</AvatarFallback>
                        </Avatar>
                        <div className={cn("absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-background shadow-sm", {
                            'bg-green-500': member.status === 'idle' || !member.status,
                            'bg-destructive': member.status === 'busy',
                            'bg-amber-500': member.onBreak,
                            'bg-slate-300': !member.active
                        })} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                            <p className="font-black uppercase tracking-tight text-sm truncate text-slate-900 leading-tight">{member.name}</p>
                            {nextAppointment?.checkInStatus === 'arrived' && <div className="w-2 h-2 rounded-full bg-green-500 animate-ping shrink-0" />}
                        </div>
                        <div className="flex items-center gap-1.5 mt-1">
                            <Badge variant="outline" className={cn("font-black text-[8px] h-4 px-1.5 uppercase tracking-widest border-none", status.className)}>
                                {status.text}
                            </Badge>
                        </div>
                    </div>
                    {canManage && (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl hover:bg-primary/5 -mt-1 -mr-1">
                                    <MoreHorizontal className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="rounded-2xl border-2 shadow-2xl p-1">
                                <DropdownMenuItem onClick={() => onForceIdle(member.id)} className="font-black uppercase text-[9px] tracking-widest text-amber-600 focus:text-amber-700 focus:bg-amber-50 rounded-xl px-3 h-10">
                                    <RefreshCw className="w-3 h-3 mr-2" />
                                    Force Reset
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}
                </div>

                {member.status === 'busy' && (
                    <div className="mt-auto space-y-1">
                        <p className="text-[9px] font-black uppercase text-muted-foreground tracking-widest opacity-60 leading-none">{member.availability?.status}</p>
                    </div>
                )}
            </CardContent>

            {isNextUp ? (
                <div className="bg-primary px-3 py-2 text-[9px] font-black uppercase text-white tracking-[0.2em] text-center shrink-0">
                    Next Up
                </div>
            ) : (
                assignmentMode === 'ordered_list' && member.active && (
                    <div className="grid grid-cols-2 border-t bg-muted/5">
                        <Button variant="ghost" className="h-10 rounded-none border-r text-muted-foreground hover:text-primary" onClick={() => onMoveUp(member.id)} disabled={isFirst}>
                            <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" className="h-10 rounded-none text-muted-foreground hover:text-primary" onClick={() => onMoveDown(member.id)} disabled={isLast}>
                            <ArrowDown className="h-4 w-4" />
                        </Button>
                    </div>
                )
            )}
        </Card>
    );
};

interface TeamStatusProps {
    staff: Staff[] | null;
    appointments: Appointment[] | null;
    resources: Resource[] | null;
    onReorder: (newOrder: Staff[]) => void;
    assignmentMode: 'fair_play' | 'ordered_list';
    onAssignmentModeChange: (mode: 'fair_play' | 'ordered_list') => void;
    onForceIdle: (id: string) => void;
    services: Service[] | null;
}

export const TeamStatus: React.FC<TeamStatusProps> = ({ staff, appointments, resources, onReorder, assignmentMode, onAssignmentModeChange, onForceIdle, services }) => {
    const { role } = useTenant();
    const canManage = role === 'owner' || role === 'admin';

    const handleMove = (staffId: string, direction: 'up' | 'down') => {
        const staffList = staff || [];
        const index = staffList.findIndex(s => s.id === staffId);
        if (index === -1) return;
        const newIndex = direction === 'up' ? index - 1 : index + 1;
        if (newIndex < 0 || newIndex >= staffList.length) return;
        const newOrder = [...staffList];
        const [movedItem] = newOrder.splice(index, 1);
        newOrder.splice(newIndex, 0, movedItem);
        onReorder(newOrder);
    };

    const resourcePulse = useMemo(() => {
        if (!resources || !appointments) return [];
        const now = new Date();
        return resources.map(res => {
            const occupiedBy = appointments.filter(a => a.status === 'servicing' && a.requiredResourceIds?.includes(res.id));
            const currentOccupancy = occupiedBy.length;
            const isAtCapacity = currentOccupancy >= (res.capacity || 1);
            let nextFreeIn = null;
            if (isAtCapacity && occupiedBy.length > 0) {
                const earliestEnd = new Date(Math.min(...occupiedBy.map(a => safeDate(a.endTime).getTime())));
                nextFreeIn = Math.max(1, differenceInMinutes(earliestEnd, now));
            }
            return { ...res, currentOccupancy, isAtCapacity, nextFreeIn };
        });
    }, [resources, appointments]);

    const { nextAvailableIn, hasIdleStaff } = useMemo(() => {
        if (!staff || !appointments) return { nextAvailableIn: null, hasIdleStaff: false };
        const idle = staff.some(s => s.active && !s.onBreak && (s.status === 'idle' || !s.status));
        if (idle) return { nextAvailableIn: 0, hasIdleStaff: true };
        const busyStaffEndTimes = staff.filter(s => s.active && !s.onBreak && s.status === 'busy').map(s => {
            const apt = appointments.find(a => a.staffId === s.id && a.status === 'servicing' && safeDate(a.endTime) > new Date());
            return apt ? safeDate(apt.endTime) : null;
        }).filter((d): d is Date => d !== null);
        if (busyStaffEndTimes.length === 0) return { nextAvailableIn: null, hasIdleStaff: false };
        const nextFreeTime = new Date(Math.min(...busyStaffEndTimes.map(d => d.getTime())));
        return { nextAvailableIn: Math.max(1, differenceInMinutes(nextFreeTime, new Date())), hasIdleStaff: false };
    }, [staff, appointments]);

    const enrichedStaff = useMemo(() => {
        if (!staff || !appointments) return [];
        const now = new Date();
        const todayStart = startOfDay(now);
        return staff.map(member => {
            let availabilityStatus = member.active ? 'Idle' : 'Off Duty';
            const currentAppointment = appointments.find(apt => {
                if (apt.status !== 'servicing') return false;
                if (apt.staffId === member.id) return !(apt.checkoutState?.completedServiceIds || []).includes(apt.serviceId);
                const overrides = apt.checkoutState?.serviceStaffOverrides || {};
                const completedIds = apt.checkoutState?.completedServiceIds || [];
                const concurrentIds = apt.checkoutState?.concurrentServiceIds || [];
                const allPartIds = [apt.serviceId, ...(apt.addOnIds || [])];
                return Object.entries(overrides).some(([svcId, sid]) => {
                    if (sid !== member.id || completedIds.includes(svcId)) return false;
                    if (concurrentIds.includes(svcId)) return true;
                    const myIndex = allPartIds.indexOf(svcId);
                    const precedingSequential = allPartIds.slice(0, myIndex).filter(pid => !concurrentIds.includes(pid));
                    return precedingSequential.every(pid => completedIds.includes(pid));
                });
            });
            const isCurrentlyBusy = !!currentAppointment || member.status === 'busy';
            if (member.active && !member.onBreak) {
                if (isCurrentlyBusy) {
                    if (currentAppointment) {
                        const minutesRemaining = differenceInMinutes(safeDate(currentAppointment.endTime), now);
                        availabilityStatus = minutesRemaining <= 0 ? "Finishing up" : `Free in ${minutesRemaining}m`;
                    } else availabilityStatus = "Busy";
                }
            }
            const nextApt = appointments.find(apt => apt.staffId === member.id && apt.status === 'confirmed' && isSameDay(safeDate(apt.startTime), todayStart) && safeDate(apt.startTime) > now);
            return { ...member, status: member.active && !member.onBreak && isCurrentlyBusy ? 'busy' : member.status, availability: { status: availabilityStatus }, nextApt };
        });
    }, [staff, appointments]);
    
    const activeStaff = useMemo(() => enrichedStaff.filter(s => s.active), [enrichedStaff]);
    const nextUpStaffId = useMemo(() => {
        const candidates = activeStaff.filter(s => !s.onBreak && s.status !== 'busy');
        if (candidates.length === 0) return null;
        const sorted = [...candidates].sort((a, b) => assignmentMode === 'fair_play' 
            ? (a.lastServedTimestamp ? parseISO(a.lastServedTimestamp).getTime() : 0) - (b.lastServedTimestamp ? parseISO(b.lastServedTimestamp).getTime() : 0)
            : (a.turnOrder || 0) - (b.turnOrder || 0));
        return sorted[0].id;
    }, [activeStaff, assignmentMode]);

    return (
        <div className="space-y-8">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="space-y-1">
                    <h3 className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-2">
                        <Users className="w-4 h-4 text-primary" />
                        Team Mastery
                    </h3>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase opacity-60">Turn rotation and expertise pulse.</p>
                </div>
                <Select value={assignmentMode} onValueChange={onAssignmentModeChange as any}>
                    <SelectTrigger className="h-11 border-2 rounded-2xl w-full sm:w-64 bg-white/50 backdrop-blur-sm font-black uppercase text-[10px] tracking-widest shadow-sm">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-2xl border-2 shadow-2xl">
                        <SelectItem value="fair_play" className="font-bold">AUTOMATIC (FAIR PLAY)</SelectItem>
                        <SelectItem value="ordered_list" className="font-bold">MANUAL (ORDERED LIST)</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
                <Card className="md:col-span-2 border-4 border-primary/20 bg-primary/5 rounded-[2.5rem] shadow-2xl shadow-primary/5 flex flex-col justify-center text-center p-6 sm:p-8 overflow-hidden relative group min-h-[140px]">
                    <div className="absolute top-0 right-0 p-4 opacity-5 transition-opacity group-hover:opacity-10"><Sparkles className="w-16 h-16 text-primary" /></div>
                    <p className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.25em] text-primary mb-2">Lead Provider Available</p>
                    <p className="text-3xl sm:text-5xl font-black text-primary tracking-tighter leading-none uppercase">
                        {hasIdleStaff ? "NOW" : nextAvailableIn !== null ? `~${nextAvailableIn}m` : "OFF DUTY"}
                    </p>
                </Card>
                
                <Card className="md:col-span-3 border-2 border-indigo-500/10 bg-indigo-500/[0.03] rounded-[2.5rem] shadow-xl shadow-indigo-500/5 min-h-[140px]">
                    <CardHeader className="p-5 pb-2"><CardTitle className="text-[10px] font-black uppercase tracking-widest text-indigo-700 flex items-center gap-2"><Building className="w-3.5 h-3.5" /> Studio Resource Pulse</CardTitle></CardHeader>
                    <CardContent className="p-5 pt-0">
                        <ScrollArea className="h-[80px]">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pr-4">
                                {resourcePulse.map(res => (
                                    <div key={res.id} className="flex items-center justify-between p-2 rounded-xl bg-white border-2 border-indigo-500/5 shadow-sm">
                                        <div className="flex items-center gap-2 min-w-0">
                                            {res.type === 'room' ? <Building className="w-3 h-3 text-indigo-400" /> : <HardHat className="w-3 h-3 text-indigo-400" />}
                                            <span className="font-black uppercase text-[8px] tracking-tight truncate">{res.name}</span>
                                        </div>
                                        {res.isAtCapacity ? <Badge className="bg-destructive text-white border-none h-4 px-1.5 text-[8px] font-black uppercase animate-pulse">{res.nextFreeIn}m</Badge> : <Badge className="bg-green-500 text-white border-none h-4 px-1.5 text-[8px] font-black uppercase">Open</Badge>}
                                    </div>
                                ))}
                            </div>
                            <ScrollBar orientation="vertical" />
                        </ScrollArea>
                    </CardContent>
                </Card>
            </div>

            <ScrollArea className="w-full pb-4">
                <div className="flex space-x-4 px-2 py-6">
                    {activeStaff.map((member, index) => (
                        <div key={member.id} className="w-[300px] shrink-0">
                            <StaffMemberCard member={member} isNextUp={member.id === nextUpStaffId} turnOrder={index + 1} onMoveUp={(id) => handleMove(id, 'up')} onMoveDown={(id) => handleMove(id, 'down')} isFirst={index === 0} isLast={index === activeStaff.length - 1} assignmentMode={assignmentMode} nextAppointment={member.nextApt} onForceIdle={onForceIdle} canManage={canManage} services={services} />
                        </div>
                    ))}
                    {activeStaff.length === 0 && (
                        <div className="w-full h-24 border-4 border-dashed rounded-[2rem] flex items-center justify-center text-muted-foreground/40 font-black uppercase tracking-widest text-xs">No Providers Clocked In</div>
                    )}
                </div>
                <ScrollBar orientation="horizontal" />
            </ScrollArea>
        </div>
    );
};
