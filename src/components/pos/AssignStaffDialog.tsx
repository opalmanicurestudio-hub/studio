
'use client';

import React, { useState } from 'react';
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
import { type WalkIn, type Staff } from '@/lib/data';
import { ScrollArea } from '../ui/scroll-area';

interface AssignStaffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  walkIn: WalkIn | null;
  staff: Staff[] | null;
  onAssign: (walkInId: string, staffId: string) => void;
}

export const AssignStaffDialog: React.FC<AssignStaffDialogProps> = ({ open, onOpenChange, walkIn, staff, onAssign }) => {
    const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);

    if (!walkIn) return null;

    const availableStaff = staff?.filter(s => s.status === 'idle');

    const handleAssign = () => {
        if (selectedStaffId) {
            onAssign(walkIn.id, selectedStaffId);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Assign Staff to {walkIn.customerName}</DialogTitle>
                    <DialogDescription>Select an available staff member for this service.</DialogDescription>
                </DialogHeader>
                <ScrollArea className="max-h-80">
                    <RadioGroup value={selectedStaffId || ''} onValueChange={setSelectedStaffId} className="p-1 space-y-2">
                        {(availableStaff || []).map(member => (
                            <Label key={member.id} htmlFor={`staff-${member.id}`} className="flex items-center gap-3 p-3 border rounded-md cursor-pointer hover:bg-accent has-[:checked]:border-primary">
                                <RadioGroupItem value={member.id} id={`staff-${member.id}`} />
                                <Avatar className="w-10 h-10">
                                    <AvatarImage src={member.avatarUrl} />
                                    <AvatarFallback>{member.name.charAt(0)}</AvatarFallback>
                                </Avatar>
                                <span className="font-semibold">{member.name}</span>
                            </Label>
                        ))}
                         {(!availableStaff || availableStaff.length === 0) && (
                            <p className="text-center text-muted-foreground p-8">No staff members are currently available.</p>
                        )}
                    </RadioGroup>
                </ScrollArea>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleAssign} disabled={!selectedStaffId}>Assign & Notify</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
