
'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { type Staff } from '@/lib/data';
import { cn } from '@/lib/utils';
import { Clock, Coffee } from 'lucide-react';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';

interface TeamStatusProps {
  staff: Staff[] | null;
  onStatusChange: (staffId: string, action: 'clock_in' | 'clock_out' | 'break_start' | 'break_end') => void;
}

const StaffMemberCard = ({ member, onStatusChange }: { member: Staff, onStatusChange: TeamStatusProps['onStatusChange'] }) => {
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
        <div className="w-48 shrink-0">
            <Card className="text-center flex flex-col h-full">
                <CardContent className="p-3 flex-1 flex flex-col items-center">
                    <Avatar className="w-16 h-16 mx-auto mb-2">
                        <AvatarImage src={member.avatarUrl} alt={member.name} />
                        <AvatarFallback>{member.name.substring(0, 2)}</AvatarFallback>
                    </Avatar>
                    <h3 className="text-sm font-semibold truncate w-full">{member.name}</h3>
                    <Badge variant="secondary" className={cn('text-xs mt-1', status.className)}>{status.text}</Badge>
                </CardContent>
                <CardFooter className="p-2 border-t mt-auto">
                    {renderActionButtons()}
                </CardFooter>
            </Card>
        </div>
    )
}


export const TeamStatus: React.FC<TeamStatusProps> = ({ staff, onStatusChange }) => {
  return (
    <div>
        <h2 className="text-xl font-bold mb-4">Team Status</h2>
        <ScrollArea>
            <div className="flex space-x-4 pb-4">
                {(staff || []).map(member => (
                    <StaffMemberCard key={member.id} member={member} onStatusChange={onStatusChange} />
                ))}
            </div>
            <ScrollBar orientation="horizontal" />
        </ScrollArea>
    </div>
  );
};
