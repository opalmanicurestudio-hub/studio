

'use client';

import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { type Staff, type Appointment } from '@/lib/data';
import { cn } from '@/lib/utils';
import { Clock, Coffee, GripVertical } from 'lucide-react';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { format, differenceInMinutes, parseISO } from 'date-fns';
import { Reorder } from 'framer-motion';

interface TeamStatusProps {
  staff: Staff[] | null;
  onStatusChange: (staffId: string, action: 'clock_in' | 'clock_out' | 'break_start' | 'break_end') => void;
  appointments: Appointment[] | null;
  onReorder: (newOrder: Staff[]) => void;
}

const StaffMemberCard = ({ member, isNextUp, availability, onStatusChange }: { member: Staff, isNextUp: boolean, availability: string | null, onStatusChange: TeamStatusProps['onStatusChange'] }) => {
    const getStatus = () => {
        if (!member.active) return { text: 'Clocked Out', className: 'bg-gray-100 text-gray-800' };
        if (member.onBreak) return { text: 'On Break', className: 'bg-yellow-100 text-yellow-800' };
        if (member.status === 'busy') return { text: 'Busy', className: 'bg-red-100 text-red-700' };
        return { text: 'Idle', className: 'bg-green-100 text-green-800' };
    };

    const status = getStatus();

    const renderActionButtons = () => {
        if (!member.active) {
            return <Button className="w-full" size="sm" onClick={() => onStatusChange(member.id, 'clock_in')}><Clock className="mr-2 h-4 w-4"/>Clock In</Button>
        }
        if (member.onBreak) {
            return (
                 <div className="grid grid-cols-2 gap-2 w-full">
                    <Button variant="destructive" size="sm" onClick={() => onStatusChange(member.id, 'clock_out')}><Clock className="mr-2 h-4 w-4"/>Clock Out</Button>
                    <Button variant="outline" size="sm" onClick={() => onStatusChange(member.id, 'break_end')}><Coffee className="mr-2 h-4 w-4"/>End Break</Button>
                </div>
            )
        }
        return (
            <div className="grid grid-cols-2 gap-2 w-full">
                <Button variant="destructive" size="sm" onClick={() => onStatusChange(member.id, 'clock_out')}><Clock className="mr-2 h-4 w-4"/>Clock Out</Button>
                <Button variant="outline" size="sm" onClick={() => onStatusChange(member.id, 'break_start')}><Coffee className="mr-2 h-4 w-4"/>Start Break</Button>
            </div>
        )
    };

    return (
        <Reorder.Item
            value={member}
            id={member.id}
            className="w-48 shrink-0 relative"
            whileDrag={{ scale: 1.05, zIndex: 10, boxShadow: '0px 10px 20px rgba(0,0,0,0.2)' }}
            transition={{ duration: 0.1 }}
        >
            <Card className="text-center flex flex-col h-full cursor-grab active:cursor-grabbing">
                <GripVertical className="absolute top-1/2 -translate-y-1/2 left-1 text-muted-foreground/50" size={20}/>
                <CardHeader className="p-3">
                    <div className="flex justify-between items-start">
                        {isNextUp ? (
                            <Badge className="bg-green-500 text-white">Next Up</Badge>
                        ) : (
                            <Badge variant={member.active ? (member.onBreak ? 'secondary' : 'default') : 'outline'} className={cn('capitalize', {
                                'bg-green-100 text-green-800 dark:bg-green-900/50': member.active && !member.onBreak && !isNextUp,
                                'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50': member.active && member.onBreak,
                                'bg-red-100 text-red-700 dark:bg-red-900/50': member.status === 'busy',
                            })}>
                                {status.text}
                            </Badge>
                        )}
                    </div>
                </CardHeader>
                <CardContent className="p-3 pt-0 flex-1 flex flex-col items-center">
                    <Avatar className="w-16 h-16 mx-auto mb-2">
                        <AvatarImage src={member.avatarUrl} alt={member.name} />
                        <AvatarFallback>{member.name.substring(0, 2)}</AvatarFallback>
                    </Avatar>
                    <h3 className="text-sm font-semibold truncate w-full">{member.name}</h3>
                    <p className="text-xs text-muted-foreground capitalize">{member.role}</p>
                    {availability && (
                        <p className="text-xs text-blue-500 font-semibold mt-2">{availability}</p>
                    )}
                </CardContent>
                <CardFooter className="p-2 border-t mt-auto">
                    {renderActionButtons()}
                </CardFooter>
            </Card>
        </Reorder.Item>
    )
}


export const TeamStatus: React.FC<TeamStatusProps> = ({ staff, onStatusChange, appointments, onReorder }) => {
    
    const idleStaff = useMemo(() => {
        if (!staff) return [];
        return staff.filter(s => s.active && !s.onBreak && s.status === 'idle');
    }, [staff]);

    const nextUpStaffId = idleStaff.length > 0 ? idleStaff[0].id : null;

    const staffWithAvailability = useMemo(() => {
        return staff?.map(member => {
            if (member.status !== 'busy' || !member.active || member.onBreak) {
                return { ...member, availability: null };
            }

            const now = new Date();
            const staffAppointments = appointments
                ?.filter(apt => apt.staffId === member.id && new Date(apt.endTime) > now)
                .sort((a,b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
            
            const currentAppointment = staffAppointments?.find(apt => new Date(apt.startTime) <= now && new Date(apt.endTime) > now);

            if (currentAppointment) {
                const minutesRemaining = differenceInMinutes(new Date(currentAppointment.endTime), now);
                if (minutesRemaining <= 0) {
                     return { ...member, availability: "Finishing up" };
                }
                return { ...member, availability: `Free in ${minutesRemaining} min` };
            }
            
            const nextAppointment = staffAppointments?.[0];
            if (nextAppointment) {
                 return { ...member, availability: `Starts at ${format(new Date(nextAppointment.startTime), 'h:mm a')}` };
            }

            return { ...member, availability: null };
        }) || [];
    }, [staff, appointments]);

    if (!staff) return null;

    return (
        <div>
            <h2 className="text-xl font-bold mb-4">Team Status & Turn Order</h2>
            <ScrollArea>
                <Reorder.Group axis="x" values={staff} onReorder={onReorder} className="flex space-x-4 pb-4">
                    {staffWithAvailability.map(member => (
                        <StaffMemberCard
                            key={member.id}
                            member={member}
                            onStatusChange={onStatusChange}
                            isNextUp={member.id === nextUpStaffId}
                            availability={member.availability}
                        />
                    ))}
                </Reorder.Group>
                <ScrollBar orientation="horizontal" />
            </ScrollArea>
        </div>
    );
};
