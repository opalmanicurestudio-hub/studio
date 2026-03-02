'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { type Staff, type Appointment, type Service, type Resource } from '@/lib/data';
import { cn } from '@/lib/utils';
import { Clock, Coffee, GripVertical, Mail, Phone, ShieldAlert, ChevronDown, MoreHorizontal, TrendingUp, ArrowUp, ArrowDown, MapPin, Car, HardHat, Building, RefreshCw } from 'lucide-react';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { format, differenceInMinutes, parseISO, isPast, differenceInDays, differenceInSeconds, isSameDay, startOfDay } from 'date-fns';
import { formatPhoneNumber } from 'react-phone-number-input';
import { Separator } from '../ui/separator';
import Link from 'next/link';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../ui/select';
import { Label } from '../ui/label';
import { useTenant } from '@/context/TenantContext';

interface TeamStatusProps {
  staff: (Staff & { stats?: any, availability?: { status: string } })[] | null;
  onStatusChange: (staffId: string, action: 'clock_in' | 'clock_out' | 'break_start' | 'break_end') => void;
  appointments: Appointment[] | null;
  services: Service[] | null;
  resources: Resource[];
  onReorder: (newOrder: Staff[]) => void;
  assignmentMode: 'fair_play' | 'ordered_list';
  onAssignmentModeChange: (mode: 'fair_play' | 'ordered_list') => void;
  onForceIdle: (staffId: string) => void;
}

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
    canManage
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
    canManage: boolean
}) => {
    
    const getStatus = () => {
        if (!member.active) return { text: 'Off Duty', className: 'bg-muted text-muted-foreground border-dashed' };
        if (member.onBreak) return { text: 'On Break', className: 'bg-yellow-100 text-yellow-800' };
        if (member.status === 'busy') return { text: 'Busy', className: 'bg-red-100 text-red-700' };
        return { text: 'Idle', className: 'bg-green-100 text-green-800' };
    };

    const status = getStatus();

    const checkInBadge = useMemo(() => {
        if (!nextAppointment) return null;
        switch (nextAppointment.checkInStatus) {
            case 'arrived':
                return <Badge className="bg-green-500 border-none text-[8px] h-4 px-1 uppercase font-black text-white"><MapPin className="w-2 h-2 mr-0.5 fill-current" /> Here</Badge>;
            case 'running_late':
                return <Badge className="bg-amber-500 border-none text-[8px] h-4 px-1 uppercase font-black text-white animate-pulse"><Clock className="w-2 h-2 mr-0.5" /> +{nextAppointment.lateTimeMinutes}m</Badge>;
            case 'on_my_way':
                return <Badge className="bg-blue-500 border-none text-[8px] h-4 px-1 uppercase font-black text-white"><Car className="w-2 h-2 mr-0.5" /> Way</Badge>;
            default:
                return null;
        }
    }, [nextAppointment]);

    const initials = (member.name || 'Staff').substring(0, 2).toUpperCase();

    return (
        <Card className={cn(
            "relative transition-all",
            isNextUp && "border-primary ring-2 ring-primary shadow-lg scale-[1.02]",
            !member.active && "opacity-60 grayscale-[0.5]"
        )}>
            <CardContent className="p-3 flex items-center gap-4">
                 {assignmentMode === 'ordered_list' && member.active && (
                    <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground font-black text-sm flex items-center justify-center border-2 border-background shadow-md">
                        {turnOrder}
                    </div>
                )}
                <Avatar className="w-12 h-12 border shadow-inner">
                    <AvatarImage src={member.avatarUrl} alt={member.name} className="object-cover" />
                    <AvatarFallback>{initials}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <p className="font-bold truncate">{member.name || 'Unnamed Staff'}</p>
                        {checkInBadge}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className={cn(status.className, "text-[10px] h-5 uppercase tracking-wider")}>{status.text}</Badge>
                        <p className="text-[10px] text-muted-foreground font-medium truncate">{member.availability?.status}</p>
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    {assignmentMode === 'ordered_list' && member.active && (
                        <div className="flex flex-col gap-1">
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onMoveUp(member.id)} disabled={isFirst}>
                                <ArrowUp className="h-5 w-5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onMoveDown(member.id)} disabled={isLast}>
                                <ArrowDown className="h-5 w-5" />
                            </Button>
                        </div>
                    )}
                    {canManage && (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                    <MoreHorizontal className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => onForceIdle(member.id)}>
                                    <RefreshCw className="w-4 h-4 mr-2" />
                                    Force Idle
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}
                </div>
            </CardContent>
            {isNextUp && (
                <Badge className="absolute -top-2 right-4 bg-primary text-primary-foreground font-black uppercase text-[9px] tracking-widest px-2 shadow-sm">Next Up</Badge>
            )}
        </Card>
    );
};


export const TeamStatus: React.FC<TeamStatusProps> = ({ staff, onStatusChange, appointments, services, resources, onReorder, assignmentMode, onAssignmentModeChange, onForceIdle }) => {
    const { role } = useTenant();
    const canManage = role === 'owner' || role === 'admin';

    const safeDate = (val: any): Date => {
        if (!val) return new Date();
        if (val instanceof Date) return val;
        if (typeof val?.toDate === 'function') return val.toDate();
        if (typeof val === 'string') return parseISO(val);
        if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
        return new Date(val);
    };

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

    const handleMoveUp = (staffId: string) => handleMove(staffId, 'up');
    const handleMoveDown = (staffId: string) => handleMove(staffId, 'down');

    const resourcePulse = useMemo(() => {
        if (!resources || !appointments) return [];
        const now = new Date();
        
        return resources.map(res => {
            const occupiedBy = appointments.filter(a => 
                a.status === 'servicing' && 
                a.requiredResourceIds?.includes(res.id)
            );
            
            const currentOccupancy = occupiedBy.length;
            const isAtCapacity = currentOccupancy >= (res.capacity || 1);
            
            let nextFreeIn = null;
            if (isAtCapacity && occupiedBy.length > 0) {
                const endTimes = occupiedBy.map(a => safeDate(a.endTime).getTime());
                const earliestEnd = new Date(Math.min(...endTimes));
                nextFreeIn = Math.max(1, differenceInMinutes(earliestEnd, now));
            }

            return {
                ...res,
                currentOccupancy,
                isAtCapacity,
                nextFreeIn
            };
        });
    }, [resources, appointments]);

    const { nextAvailableIn, hasIdleStaff } = useMemo(() => {
        if (!staff || !appointments) return { nextAvailableIn: null, hasIdleStaff: false };

        const idleStaff = staff.some(s => s.active && !s.onBreak && (s.status === 'idle' || !s.status));

        if (idleStaff) {
            return { nextAvailableIn: 0, hasIdleStaff: true };
        }

        const busyStaffEndTimes = staff
            .filter(s => s.active && !s.onBreak && s.status === 'busy')
            .map(s => {
                const now = new Date();
                const currentAppointment = appointments.find(apt => 
                    apt.staffId === s.id && 
                    apt.status === 'servicing' &&
                    safeDate(apt.endTime) > now
                );
                return currentAppointment ? safeDate(currentAppointment.endTime) : null;
            })
            .filter((endTime): endTime is Date => endTime !== null);
        
        if (busyStaffEndTimes.length === 0) {
            return { nextAvailableIn: null, hasIdleStaff: false };
        }

        const nextFreeTime = new Date(Math.min(...busyStaffEndTimes.map(d => d.getTime())));
        const minutesUntilFree = differenceInMinutes(nextFreeTime, new Date());

        return { nextAvailableIn: Math.max(1, minutesUntilFree), hasIdleStaff: false };
    }, [staff, appointments]);

    const enrichedStaff = useMemo(() => {
        if (!staff || !appointments) return [];
        const now = new Date();
        const todayStart = startOfDay(now);

        return staff.map(member => {
            let availabilityStatus = member.active ? 'Idle' : 'Off Duty';
            let nextApt = null;

            // Check if member is working on ANY part of an active service
            const currentAppointment = appointments.find(apt => {
                if (apt.status !== 'servicing') return false;
                
                // Primary provider
                if (apt.staffId === member.id) {
                    // Still busy if the main service isn't done
                    return !(apt.checkoutState?.completedServiceIds || []).includes(apt.serviceId);
                }

                // Assistant / Sequential provider
                const overrides = apt.checkoutState?.serviceStaffOverrides || {};
                const completedIds = apt.checkoutState?.completedServiceIds || [];
                const concurrentIds = apt.checkoutState?.concurrentServiceIds || [];
                const allPartIds = [apt.serviceId, ...(apt.addOnIds || [])];

                return Object.entries(overrides).some(([svcId, sid]) => {
                    if (sid !== member.id || completedIds.includes(svcId)) return false;

                    // Concurrent assistants are always busy
                    if (concurrentIds.includes(svcId)) return true;

                    // Sequential turn check
                    const myIndex = allPartIds.indexOf(svcId);
                    const precedingSequential = allPartIds.slice(0, myIndex).filter(pid => !concurrentIds.includes(pid));
                    return precedingSequential.every(pid => completedIds.includes(pid));
                });
            });

            const isCurrentlyBusy = !!currentAppointment || member.status === 'busy';

            if (member.active && !member.onBreak) {
                if (isCurrentlyBusy) {
                    if (currentAppointment) {
                        const d = safeDate(currentAppointment.endTime);
                        const minutesRemaining = differenceInMinutes(d, now);
                        availabilityStatus = minutesRemaining <= 0 ? "Finishing up" : `Free in ${minutesRemaining} min`;
                    } else {
                        availabilityStatus = "Busy";
                    }
                }

                nextApt = appointments.find(apt => 
                    apt.staffId === member.id && 
                    apt.status === 'confirmed' && 
                    isSameDay(safeDate(apt.startTime), todayStart) &&
                    safeDate(apt.startTime) > now
                );
            }

            return { 
                ...member, 
                status: member.active && !member.onBreak && isCurrentlyBusy ? 'busy' : member.status,
                availability: { status: availabilityStatus }, 
                nextApt 
            };
        });
    }, [staff, appointments]);
    
    const activeStaff = useMemo(() => enrichedStaff.filter(s => s.active), [enrichedStaff]);
    const offDutyStaff = useMemo(() => enrichedStaff.filter(s => !s.active), [enrichedStaff]);

    const nextUpStaffId = useMemo(() => {
        const candidates = activeStaff.filter(s => !s.onBreak && (s.status === 'idle' || !s.status));
        if (candidates.length === 0) return null;

        if (assignmentMode === 'fair_play') {
            const sorted = [...candidates].sort((a, b) => (a.lastServedTimestamp ? parseISO(a.lastServedTimestamp).getTime() : 0) - (b.lastServedTimestamp ? parseISO(b.lastServedTimestamp).getTime() : 0));
            return sorted[0].id;
        } else {
            const sorted = [...candidates].sort((a, b) => (a.turnOrder || 0) - (b.turnOrder || 0));
            return sorted[0].id;
        }
    }, [activeStaff, assignmentMode]);

    if (!staff) return null;

    return (
        <Card className="border-2 shadow-sm">
            <CardHeader className="pb-4">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div className="space-y-1">
                        <CardTitle className="text-xl">Team Status</CardTitle>
                        <CardDescription>Real-time availability and assignment rotation.</CardDescription>
                    </div>
                    <div className="w-full sm:w-64">
                        <Select value={assignmentMode} onValueChange={onAssignmentModeChange as (value: string) => void}>
                            <SelectTrigger className="h-11 border-2">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="fair_play">Automatic (Fair Play)</SelectItem>
                                <SelectItem value="ordered_list">Manual (Ordered List)</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-6 bg-primary/5 border-2 border-primary/10 rounded-2xl text-center flex flex-col justify-center">
                        <p className="text-[10px] font-black uppercase text-primary tracking-widest mb-1">Next Available Provider</p>
                        <p className="text-4xl font-black text-primary tracking-tighter">
                            {hasIdleStaff ? "Available Now" : 
                            nextAvailableIn !== null ? `~${nextAvailableIn} min` : 
                            "None on Duty"
                            }
                        </p>
                    </div>
                    
                    <Card className="border-2 border-indigo-500/10 bg-indigo-500/5">
                        <CardHeader className="p-4 pb-2">
                            <CardTitle className="text-xs font-black uppercase tracking-widest text-indigo-700 flex items-center gap-2">
                                <Clock className="w-3.5 h-3.5" />
                                Resource Pulse
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-4 pt-0">
                            <ScrollArea className="h-[100px]">
                                <div className="space-y-2 pr-3">
                                    {resourcePulse.map(res => (
                                        <div key={res.id} className="flex items-center justify-between gap-3 text-xs bg-background p-2 rounded-lg border shadow-sm">
                                            <div className="flex items-center gap-2 truncate">
                                                {res.type === 'room' ? <Building className="w-3 h-3 text-muted-foreground" /> : <HardHat className="w-3 h-3 text-muted-foreground" />}
                                                <span className="font-bold truncate">{res.name}</span>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                {res.isAtCapacity ? (
                                                    <Badge variant="destructive" className="h-5 text-[9px] font-black uppercase tracking-tighter border-none animate-pulse">
                                                        Busy ({res.nextFreeIn}m)
                                                    </Badge>
                                                ) : (
                                                    <Badge variant="secondary" className="h-5 text-[9px] font-black uppercase tracking-tighter bg-green-500/10 text-green-700 border-none">
                                                        Open ({res.capacity! - res.currentOccupancy}/{res.capacity})
                                                    </Badge>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </ScrollArea>
                        </CardContent>
                    </Card>
                </div>

                <div className="space-y-4">
                    <div>
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
                            <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                            Clocked In ({activeStaff.length})
                        </h4>
                        <div className="space-y-3">
                            {activeStaff.map((member, index) => (
                                <StaffMemberCard
                                    key={member.id}
                                    member={member}
                                    isNextUp={member.id === nextUpStaffId}
                                    turnOrder={index + 1}
                                    onMoveUp={handleMoveUp}
                                    onMoveDown={handleMoveDown}
                                    isFirst={index === 0}
                                    isLast={index === activeStaff.length - 1}
                                    assignmentMode={assignmentMode}
                                    nextAppointment={member.nextApt}
                                    onForceIdle={onForceIdle}
                                    canManage={canManage}
                                />
                            ))}
                            {activeStaff.length === 0 && (
                                <p className="text-sm text-muted-foreground text-center py-4 border-2 border-dashed rounded-xl">No providers currently clocked in.</p>
                            )}
                        </div>
                    </div>

                    {offDutyStaff.length > 0 && (
                        <div>
                            <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-3">Off Duty ({offDutyStaff.length})</h4>
                            <div className="space-y-3">
                                {offDutyStaff.map(member => (
                                    <StaffMemberCard
                                        key={member.id}
                                        member={member}
                                        isNextUp={false}
                                        turnOrder={null}
                                        onMoveUp={() => {}}
                                        onMoveDown={() => {}}
                                        isFirst={false}
                                        isLast={false}
                                        assignmentMode={assignmentMode}
                                        onForceIdle={onForceIdle}
                                        canManage={canManage}
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
};
