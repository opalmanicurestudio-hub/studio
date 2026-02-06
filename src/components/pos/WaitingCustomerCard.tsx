

'use client';

import React from 'react';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { type WalkIn, type Service, Staff } from '@/lib/data';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { User, Clock, UserPlus, Play, Users, GripVertical } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '../ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Badge } from '../ui/badge';

interface WaitingCustomerCardProps {
    walkIn: WalkIn;
    services: Service[] | null;
    staffList: Staff[] | null;
    onAssign: () => void;
    onStartService: (walkInId: string, personId: string) => void;
}

export const WaitingCustomerCard: React.FC<WaitingCustomerCardProps> = ({ walkIn, services, staffList, onAssign, onStartService }) => {
    const primaryServices = services?.filter(s => walkIn.serviceIds.includes(s.id));
    const waitTime = formatDistanceToNow(parseISO(walkIn.checkInTime), { addSuffix: true });
    
    const isGroup = walkIn.partyMembers && walkIn.partyMembers.length > 0;
    const groupCount = (walkIn.partyMembers?.length || 0) + 1;
    
    const people = [
        { id: walkIn.clientId || walkIn.id, name: walkIn.customerName, serviceIds: walkIn.serviceIds },
        ...(walkIn.partyMembers || [])
    ];

    const getAssignedStaff = (personId: string): Staff | undefined => {
        const staffId = walkIn.assignments?.[personId];
        return staffList?.find(s => s.id === staffId);
    };

    return (
        <Card>
            <CardContent className="p-4 flex items-start gap-1">
                <div className="cursor-grab text-muted-foreground p-2 -ml-2 mt-5">
                    <GripVertical className="w-5 h-5" />
                </div>
                <div className="flex-1">
                    <div className="flex justify-between items-start">
                        <div>
                            <p className="font-semibold flex items-center gap-2">
                                <User className="w-4 h-4"/>
                                {walkIn.customerName}
                                {isGroup && <span className="text-muted-foreground font-normal flex items-center gap-1">(<Users className="w-3 h-3"/>{groupCount})</span>}
                            </p>
                            <p className="text-sm text-muted-foreground flex items-center gap-2"><Clock className="w-4 h-4"/>Waiting {waitTime}</p>
                        </div>
                        <div className="text-right">
                            {primaryServices?.map(s => <p key={s.id} className="text-sm">{s.name}</p>)}
                            <p className="text-xs text-muted-foreground">{walkIn.estimatedDuration} min total</p>
                        </div>
                    </div>
                     {walkIn.assignments && (
                        <div className="text-xs mt-2 space-y-1">
                            {Object.entries(walkIn.assignments).map(([personId, staffId]) => {
                                const person = people.find(p => p.id === personId);
                                const staff = staffList?.find(s => s.id === staffId);
                                if (!person || !staff) return null;
                                return (
                                    <div key={personId} className="flex items-center gap-2">
                                        <Badge variant="secondary">{person.name} &rarr; {staff.name}</Badge>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            </CardContent>
            <CardFooter className="p-2 border-t grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={onAssign}><UserPlus className="w-4 h-4 mr-2" />Assign</Button>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button disabled={!walkIn.assignments || Object.keys(walkIn.assignments).length === 0}><Play className="w-4 h-4 mr-2" />Start Service</Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                        {people.map(person => {
                            const assignedStaff = getAssignedStaff(person.id);
                            return (
                                <DropdownMenuItem 
                                    key={person.id} 
                                    disabled={!assignedStaff}
                                    onSelect={() => onStartService(walkIn.id, person.id)}
                                >
                                    <div className="flex items-center justify-between w-full">
                                        <span>Start for {person.name}</span>
                                        {assignedStaff && (
                                             <div className="flex items-center gap-1 text-xs text-muted-foreground ml-2">
                                                <Avatar className="w-4 h-4"><AvatarImage src={assignedStaff.avatarUrl} /><AvatarFallback>{assignedStaff.name.charAt(0)}</AvatarFallback></Avatar>
                                                <span>{assignedStaff.name.split(' ')[0]}</span>
                                            </div>
                                        )}
                                    </div>
                                </DropdownMenuItem>
                            )
                        })}
                    </DropdownMenuContent>
                </DropdownMenu>
            </CardFooter>
        </Card>
    );
};
