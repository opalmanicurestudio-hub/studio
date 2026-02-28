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
import { useInventory } from '@/context/InventoryContext';
import { Switch } from '../ui/switch';
import { Badge } from '../ui/badge';
import { cn } from '@/lib/utils';

interface AssignStaffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  walkIn: WalkIn | null;
  staff: Staff[] | null;
  onAssign: (walkInId: string, staffId: string) => void;
  onToggleWaitForStaff: (walkInId: string, wait: boolean) => void;
}

export const AssignStaffDialog: React.FC<AssignStaffDialogProps> = ({ open, onOpenChange, walkIn, staff, onAssign, onToggleWaitForStaff }) => {
    const { services } = useInventory();
    const [selectedStaffId, setSelectedStaffId] = useState('');

    useEffect(() => {
        if (walkIn) {
            // Pre-select preferred staff if they are waiting for them
            const initialSelection = (walkIn.preferredStaffId && walkIn.waitForPreferredStaff) 
                ? walkIn.preferredStaffId 
                : '';
            setSelectedStaffId(walkIn.assignedStaffId || initialSelection);
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

    // REQUIREMENT: Staff must be clocked in (active) to be available for assignment
    const availableStaff = staff?.filter(s => s.active && !s.onBreak && s.status === 'idle') || [];
    const preferredStaff = staff?.find(s => s.id === walkIn.preferredStaffId);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Assign Staff to {walkIn.customerName}</DialogTitle>
                    <DialogDescription>Requested service: {personServices}.</DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-4">
                    {preferredStaff && (
                        <div className={cn("flex items-center justify-between rounded-lg border p-3", preferredStaff.active ? "bg-primary/5 border-primary/20" : "bg-muted/50 border-dashed opacity-60")}>
                            <div className="space-y-0.5">
                                <Label htmlFor="wait-for-preferred" className="font-bold">Wait for {preferredStaff.name.split(' ')[0]}?</Label>
                                {!preferredStaff.active && <p className="text-[10px] text-destructive uppercase font-black">Not Clocked In</p>}
                            </div>
                            <Switch
                                id="wait-for-preferred"
                                checked={walkIn.waitForPreferredStaff}
                                onCheckedChange={(checked) => onToggleWaitForStaff(walkIn.id, checked)}
                            />
                        </div>
                    )}
                    <RadioGroup value={selectedStaffId} onValueChange={setSelectedStaffId}>
                        <div className="space-y-2">
                        {availableStaff.length > 0 ? availableStaff.map(member => (
                            <Label key={member.id} htmlFor={`staff-assign-${member.id}`} className={cn("flex items-center gap-4 p-3 border-2 rounded-xl cursor-pointer hover:bg-muted transition-all has-[:checked]:border-primary has-[:checked]:bg-primary/5", {
                                "border-primary/20 shadow-sm": member.id === walkIn.preferredStaffId
                            })}>
                                <RadioGroupItem value={member.id} id={`staff-assign-${member.id}`} />
                                <Avatar className="w-10 h-10 border shadow-sm">
                                    <AvatarImage src={member.avatarUrl} className="object-cover" />
                                    <AvatarFallback>{member.name.charAt(0)}</AvatarFallback>
                                </Avatar>
                                <div className="flex-1">
                                    <p className="font-bold">{member.name}</p>
                                    {member.id === walkIn.preferredStaffId && <p className="text-[10px] font-black uppercase text-primary tracking-widest">Client Preference</p>}
                                </div>
                                {member.id === walkIn.preferredStaffId && !walkIn.waitForPreferredStaff && (
                                     <Badge variant="destructive" className="h-5 text-[9px] uppercase">Not Waiting</Badge>
                                )}
                            </Label>
                        )) : (
                            <div className="p-8 text-center text-sm text-muted-foreground border-2 border-dashed rounded-xl">
                                <Users className="w-8 h-8 mx-auto mb-2 opacity-20" />
                                <p>No available providers currently clocked in.</p>
                            </div>
                        )}
                        </div>
                    </RadioGroup>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleAssign} disabled={!selectedStaffId} className="font-bold h-11 px-8">Assign & Notify</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
