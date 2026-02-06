

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
  onAssign: (walkInId: string, staffId: string) => void;
}

export const AssignStaffDialog: React.FC<AssignStaffDialogProps> = ({ open, onOpenChange, walkIn, staff, onAssign }) => {
    const { services } = useInventory();
    const [selectedStaffId, setSelectedStaffId] = useState('');

    useEffect(() => {
        if (walkIn) {
            setSelectedStaffId(walkIn.assignedStaffId || '');
        } else {
            setSelectedStaffId('');
        }
    }, [walkIn]);

    if (!walkIn) return null;
    
    const personServices = walkIn.serviceIds.map(id => services.find(s => s.id === id)?.name).join(', ');

    const handleAssign = () => {
        if (selectedStaffId) {
            onAssign(walkIn.id, selectedStaffId);
        }
    };

    const availableStaff = staff?.filter(s => s.active && !s.onBreak && s.status === 'idle') || [];

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Assign Staff to {walkIn.customerName}</DialogTitle>
                    <DialogDescription>Select an available staff member for their requested service: {personServices}.</DialogDescription>
                </DialogHeader>
                <div className="py-4">
                    <RadioGroup value={selectedStaffId} onValueChange={setSelectedStaffId}>
                        <div className="space-y-2">
                        {availableStaff.map(member => (
                            <Label key={member.id} htmlFor={`staff-assign-${member.id}`} className="flex items-center gap-4 p-3 border rounded-md cursor-pointer hover:bg-muted has-[:checked]:border-primary">
                                <RadioGroupItem value={member.id} id={`staff-assign-${member.id}`} />
                                <Avatar className="w-10 h-10">
                                    <AvatarImage src={member.avatarUrl} />
                                    <AvatarFallback>{member.name.charAt(0)}</AvatarFallback>
                                </Avatar>
                                <span className="font-semibold">{member.name}</span>
                            </Label>
                        ))}
                        {availableStaff.length === 0 && (
                            <div className="p-4 text-center text-sm text-muted-foreground">No staff available.</div>
                        )}
                        </div>
                    </RadioGroup>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleAssign} disabled={!selectedStaffId}>Assign & Notify</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
