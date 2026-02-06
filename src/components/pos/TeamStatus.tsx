

'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { type Staff, type Appointment, type Service } from '@/lib/data';
import { cn } from '@/lib/utils';
import { Clock, Coffee, GripVertical, Mail, Phone, ShieldAlert, ChevronDown, MoreHorizontal, TrendingUp, ArrowUp, ArrowDown } from 'lucide-react';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { format, differenceInMinutes, parseISO, isPast, differenceInDays, differenceInSeconds } from 'date-fns';
import { Reorder } from 'framer-motion';
import { formatPhoneNumber } from 'react-phone-number-input';
import { Separator } from '../ui/separator';
import Link from 'next/link';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../ui/select';
import { Label } from '../ui/label';

interface TeamStatusProps {
  staff: (Staff & { stats?: any })[] | null;
  onStatusChange: (staffId: string, action: 'clock_in' | 'clock_out' | 'break_start' | 'break_end') => void;
  appointments: Appointment[] | null;
  services: Service[] | null;
  onReorder: (newOrder: Staff[]) => void;
  assignmentMode: 'fair_play' | 'ordered_list';
  onAssignmentModeChange: (mode: 'fair_play' | 'ordered_list') => void;
}

const StaffMemberCard = ({ 
    member, 
    isNextUp, 
    turnOrder, 
    onMoveUp, 
    onMoveDown, 
    isFirst, 
    isLast, 
    assignmentMode 
}: { 
    member: Staff, 
    isNextUp: boolean, 
    turnOrder: number, 
    onMoveUp: (id: string) => void,
    onMoveDown: (id: string) => void,
    isFirst: boolean,
    isLast: boolean,
    assignmentMode: 'fair_play' | 'ordered_list'
}) => {
    
    const getStatus = () => {
        if (!member.active) return { text: 'Clocked Out', className: 'bg-gray-100 text-gray-800' };
        if (member.onBreak) return { text: 'On Break', className: 'bg-yellow-100 text-yellow-800' };
        if (member.status === 'busy') return { text: 'Busy', className: 'bg-red-100 text-red-700' };
        return { text: 'Idle', className: 'bg-green-100 text-green-800' };
    };

    const status = getStatus();

    return (
        <Card className={cn(
            "relative",
            isNextUp && assignmentMode === 'ordered_list' && "border-primary ring-2 ring-primary"
        )}>
            <CardContent className="p-3 flex items-center gap-4">
                 {assignmentMode === 'ordered_list' && (
                    <div className="w-8 h-8 rounded-full bg-muted text-muted-foreground font-bold text-sm flex items-center justify-center border-2 border-background shadow-md">
                        {turnOrder}
                    </div>
                )}
                <Avatar className="w-12 h-12">
                    <AvatarImage src={member.avatarUrl} alt={member.name} />
                    <AvatarFallback>{member.name.substring(0, 2)}</AvatarFallback>
                </Avatar>
                <div className="flex-1">
                    <p className="font-semibold">{member.name}</p>
                    <Badge variant={status.text === 'Idle' ? 'default' : 'secondary'} className={cn(status.className, 'capitalize')}>{status.text}</Badge>
                </div>
                {assignmentMode === 'ordered_list' && (
                    <div className="flex flex-col gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onMoveUp(member.id)} disabled={isFirst}>
                            <ArrowUp className="h-5 w-5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onMoveDown(member.id)} disabled={isLast}>
                            <ArrowDown className="h-5 w-5" />
                        </Button>
                    </div>
                )}
            </CardContent>
            {isNextUp && assignmentMode === 'ordered_list' && (
                <Badge className="absolute -top-2 right-4">Next Up</Badge>
            )}
        </Card>
    );
};


export const TeamStatus: React.FC<TeamStatusProps> = ({ staff, onStatusChange, appointments, services, onReorder, assignmentMode, onAssignmentModeChange }) => {
    
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

    const staffWithAvailability = useMemo(() => {
        return staff?.map(member => {
            let availability: { status: string, serviceName?: string | null, isOvertime?: boolean, elapsedTime?: string | null } | null = null;
            if (member.status === 'busy' && member.active && !member.onBreak) {
                const now = new Date();
                const currentAppointment = appointments?.find(apt => apt.staffId === member.id && new Date(apt.startTime) <= now && new Date(apt.endTime) > now);
                if (currentAppointment) {
                    const service = services?.find(s => s.id === currentAppointment.serviceId);
                    const minutesRemaining = differenceInMinutes(new Date(currentAppointment.endTime), now);
                    if (minutesRemaining <= 0) {
                        availability = { status: "Finishing up", serviceName: service?.name };
                    } else {
                        availability = { status: `Free in ${minutesRemaining} min`, serviceName: service?.name };
                    }
                } else {
                     availability = { status: 'Busy' };
                }
            } else if (member.active && !member.onBreak && member.status === 'idle') {
                availability = { status: 'Idle' };
            }
            return { ...member, availability };
        }) || [];
    }, [staff, appointments, services]);
    
    const nextUpStaffId = useMemo(() => {
        if (assignmentMode === 'fair_play') {
            const idleStaff = staff?.filter(s => s.active && !s.onBreak && s.status === 'idle').sort((a, b) => (a.lastServedTimestamp ? parseISO(a.lastServedTimestamp).getTime() : 0) - (b.lastServedTimestamp ? parseISO(b.lastServedTimestamp).getTime() : 0));
            return idleStaff && idleStaff.length > 0 ? idleStaff[0].id : null;
        } else { // 'ordered_list'
            const firstIdle = staff?.find(s => s.active && !s.onBreak && s.status === 'idle');
            return firstIdle ? firstIdle.id : null;
        }
    }, [staff, assignmentMode]);

    if (!staff) return null;

    return (
        <Card>
            <CardHeader>
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                    <div>
                        <CardTitle>Team Status</CardTitle>
                        <CardDescription>Current availability and assignment mode.</CardDescription>
                    </div>
                    <div className="w-full sm:w-56">
                        <Label htmlFor="assignment-mode" className="text-xs font-medium sr-only">Assignment Mode</Label>
                        <Select value={assignmentMode} onValueChange={onAssignmentModeChange as (value: string) => void}>
                            <SelectTrigger id="assignment-mode">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="fair_play">Automatic (Fair Play)</SelectItem>
                                <SelectItem value="ordered_list">Ordered List</SelectItem>
                            </SelectContent>
                        </Select>
                         {assignmentMode === 'ordered_list' && <p className="text-xs text-muted-foreground mt-1">Move staff up or down to set turn order.</p>}
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <div className="space-y-3">
                    {staffWithAvailability.map((member, index) => (
                        <StaffMemberCard
                            key={member.id}
                            member={member}
                            isNextUp={member.id === nextUpStaffId}
                            onStatusChange={onStatusChange}
                            turnOrder={index + 1}
                            onMoveUp={handleMoveUp}
                            onMoveDown={handleMoveDown}
                            isFirst={index === 0}
                            isLast={index === staffWithAvailability.length - 1}
                            assignmentMode={assignmentMode}
                        />
                    ))}
                </div>
            </CardContent>
        </Card>
    );
};
