

'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { type WalkIn, type Staff, type Service } from '@/lib/data';
import { ScrollArea } from '../ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { useInventory } from '@/context/InventoryContext';

interface AssignStaffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  walkIn: WalkIn | null;
  staff: Staff[] | null;
  onAssign: (walkInId: string, assignments: Record<string, string>) => void;
}

export const AssignStaffDialog: React.FC<AssignStaffDialogProps> = ({ open, onOpenChange, walkIn, staff, onAssign }) => {
    const { services } = useInventory();
    const [assignments, setAssignments] = useState<Record<string, string>>({});

    useEffect(() => {
        if (walkIn) {
            setAssignments(walkIn.assignments || {});
        } else {
            setAssignments({});
        }
    }, [walkIn]);

    if (!walkIn) return null;

    const isGroup = walkIn.partyMembers && walkIn.partyMembers.length > 0;
    
    const people = isGroup
      ? [{ id: walkIn.clientId || walkIn.id, name: walkIn.customerName, serviceIds: walkIn.serviceIds }, ...(walkIn.partyMembers || [])]
      : [{ id: walkIn.clientId || walkIn.id, name: walkIn.customerName, serviceIds: walkIn.serviceIds }];

    const handleAssign = () => {
        onAssign(walkIn.id, assignments);
    };
    
    const handleAssignmentChange = (personId: string, staffId: string) => {
        setAssignments(prev => ({...prev, [personId]: staffId }));
    }

    const availableStaff = staff?.filter(s => s.status === 'idle' && s.active && !s.onBreak) || [];

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Assign Staff to {walkIn.customerName}{isGroup && `'s Group`}</DialogTitle>
                    <DialogDescription>Select an available staff member for each person.</DialogDescription>
                </DialogHeader>
                <ScrollArea className="max-h-80 pr-4 -mr-4">
                    <div className="space-y-4 py-4">
                        {people.map(person => {
                            const personServices = person.serviceIds.map(id => services.find(s => s.id === id)?.name).join(', ');
                            return (
                                <div key={person.id} className="p-4 border rounded-lg">
                                    <p className="font-semibold">{person.name}</p>
                                    <p className="text-xs text-muted-foreground mb-3">{personServices}</p>
                                    <Select onValueChange={(staffId) => handleAssignmentChange(person.id, staffId)} value={assignments[person.id]}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select a staff member" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {availableStaff.map(member => (
                                                <SelectItem key={member.id} value={member.id}>
                                                     <div className="flex items-center gap-2">
                                                        <Avatar className="w-6 h-6">
                                                            <AvatarImage src={member.avatarUrl} />
                                                            <AvatarFallback>{member.name.charAt(0)}</AvatarFallback>
                                                        </Avatar>
                                                        <span>{member.name}</span>
                                                    </div>
                                                </SelectItem>
                                            ))}
                                            {availableStaff.length === 0 && (
                                                <div className="p-4 text-center text-sm text-muted-foreground">No staff available.</div>
                                            )}
                                        </SelectContent>
                                    </Select>
                                </div>
                            )
                        })}
                    </div>
                </ScrollArea>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleAssign} disabled={Object.keys(assignments).length === 0}>Assign & Notify</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
