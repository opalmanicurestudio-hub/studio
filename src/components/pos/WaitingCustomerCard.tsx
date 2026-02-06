

'use client';

import React from 'react';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { type WalkIn, type Service, Staff } from '@/lib/data';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { User, Clock, UserPlus, Play, Users, GripVertical, ChevronDown, Trash2, TrendingUp } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '../ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Badge } from '../ui/badge';

interface WaitingCustomerCardProps {
    walkIn: WalkIn;
    services: Service[] | null;
    staffList: Staff[] | null;
    onAssign: () => void;
    onCancel: (walkInId: string) => void;
    onMoveToFront: (walkInId: string) => void;
    groupSize: number;
}

export const WaitingCustomerCard: React.FC<WaitingCustomerCardProps> = ({ walkIn, services, staffList, onAssign, onCancel, onMoveToFront, groupSize }) => {
    const primaryServices = services?.filter(s => walkIn.serviceIds.includes(s.id));
    const waitTime = formatDistanceToNow(parseISO(walkIn.checkInTime), { addSuffix: true });
    
    const isGroup = groupSize > 1;

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
                            </p>
                            <p className="text-sm text-muted-foreground flex items-center gap-2"><Clock className="w-4 h-4"/>Waiting {waitTime}</p>
                            {isGroup && (
                                <Badge variant="secondary" className="mt-1">
                                    <Users className="w-3 h-3 mr-1" />
                                    {walkIn.groupName}
                                </Badge>
                            )}
                        </div>
                        <div className="text-right">
                            {primaryServices?.map(s => <p key={s.id} className="text-sm">{s.name}</p>)}
                            <p className="text-xs text-muted-foreground">{walkIn.estimatedDuration} min total</p>
                        </div>
                    </div>
                     {walkIn.assignedStaffId && (
                        <div className="text-xs mt-2 space-y-1">
                            <div className="flex items-center gap-2">
                                <Badge variant="secondary">Assigned to: {staffList?.find(s => s.id === walkIn.assignedStaffId)?.name || 'N/A'}</Badge>
                            </div>
                        </div>
                    )}
                </div>
            </CardContent>
            <CardFooter className="p-2 border-t">
                 <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" className="w-full">
                            Actions
                            <ChevronDown className="w-4 h-4 ml-auto" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-[--radix-dropdown-menu-trigger-width)]">
                        <DropdownMenuItem onClick={() => onMoveToFront(walkIn.id)}>
                            <TrendingUp className="w-4 h-4 mr-2" />
                            Move to Front
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={onAssign}>
                            <UserPlus className="w-4 h-4 mr-2" />
                            Assign Staff
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive" onClick={() => onCancel(walkIn.id)}>
                            <Trash2 className="w-4 h-4 mr-2" />
                            Cancel Walk-in
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </CardFooter>
        </Card>
    );
};
