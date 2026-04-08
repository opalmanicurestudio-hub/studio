'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Users } from 'lucide-react';
import { type WalkIn, type Staff, type Service } from '@/lib/data';
import { useInventory } from '@/context/InventoryContext';
import { Switch } from '../ui/switch';
import { Badge } from '../ui/badge';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

interface AssignStaffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  walkIn: WalkIn | null;
  staff: Staff[] | null;
  onAssign: (walkInId: string, staffId: string) => void;
  onToggleWaitForStaff: (walkInId: string, wait: boolean) => void;
}

export const AssignStaffDialog: React.FC<AssignStaffDialogProps> = ({
  open, onOpenChange, walkIn, staff, onAssign, onToggleWaitForStaff,
}) => {
  const { services, shifts } = useInventory();
  const [selectedStaffId, setSelectedStaffId] = useState('');

  useEffect(() => {
    if (walkIn) {
      const initial = (walkIn.preferredStaffId && walkIn.waitForPreferredStaff)
        ? walkIn.preferredStaffId : '';
      setSelectedStaffId(walkIn.assignedStaffId || initial);
    } else {
      setSelectedStaffId('');
    }
  }, [walkIn]);

  if (!walkIn) return null;

  const personServices = walkIn.serviceIds
    .map(id => services.find(s => s.id === id)?.name)
    .filter(Boolean)
    .join(', ');

  const todayStr = format(new Date(), 'yyyy-MM-dd');

  // ── Turn order: mirrors Staff Portal WalkInLeaderboard exactly ──
  // 1. Must be on shift today (not cancelled)
  // 2. Must not have acceptingWalkIns === false
  // 3. Must be clocked in (active) and not on break
  // 4. Status can be 'idle', 'available', or 'busy' (finishing up) — not strictly idle-only
  // 5. Sorted by lastWalkInCompletedAt asc (fairplay rotation — served longest ago goes first)
  const turnOrderedStaff = useMemo(() => {
    if (!staff) return [];
    const todayShiftStaffIds = new Set(
      (shifts || [])
        .filter((s: any) => s.date === todayStr && s.status !== 'cancelled' && s.status !== 'draft')
        .map((s: any) => s.staffId)
    );
    return [...staff]
      .filter(s =>
        todayShiftStaffIds.has(s.id) &&    // on shift today
        s.active &&                         // clocked in
        !s.onBreak &&                       // not on break
        (s as any).acceptingWalkIns !== false // accepting walk-ins
      )
      .sort((a, b) => {
        // Whoever completed a walk-in longest ago goes first (fair-play rotation)
        const aLast = (a as any).lastWalkInCompletedAt
          ? new Date((a as any).lastWalkInCompletedAt).getTime() : 0;
        const bLast = (b as any).lastWalkInCompletedAt
          ? new Date((b as any).lastWalkInCompletedAt).getTime() : 0;
        return aLast - bLast;
      });
  }, [staff, shifts, todayStr]);

  // Auto-select the first in turn order when dialog opens (auto-turn behaviour)
  useEffect(() => {
    if (open && !walkIn.assignedStaffId && turnOrderedStaff.length > 0 && !selectedStaffId) {
      setSelectedStaffId(turnOrderedStaff[0].id);
    }
  }, [open, turnOrderedStaff, walkIn?.assignedStaffId]);

  const preferredStaff = staff?.find(s => s.id === walkIn.preferredStaffId);

  const handleAssign = () => {
    if (selectedStaffId) {
      onAssign(walkIn.id, selectedStaffId);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Assign Staff to {walkIn.customerName}</DialogTitle>
          <DialogDescription>Requested service: {personServices}.</DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
          {preferredStaff && (
            <div className={cn(
              'flex items-center justify-between rounded-lg border p-3',
              preferredStaff.active ? 'bg-primary/5 border-primary/20' : 'bg-muted/50 border-dashed opacity-60'
            )}>
              <div className="space-y-0.5">
                <Label htmlFor="wait-for-preferred" className="font-bold">
                  Wait for {preferredStaff.name.split(' ')[0]}?
                </Label>
                {!preferredStaff.active && (
                  <p className="text-[10px] text-destructive uppercase font-black">Not Clocked In</p>
                )}
              </div>
              <Switch
                id="wait-for-preferred"
                checked={walkIn.waitForPreferredStaff}
                onCheckedChange={checked => onToggleWaitForStaff(walkIn.id, checked)}
              />
            </div>
          )}

          {turnOrderedStaff.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground border-2 border-dashed rounded-xl">
              <Users className="w-8 h-8 mx-auto mb-2 opacity-20" />
              <p className="font-bold">No available providers accepting walk-ins.</p>
              <p className="text-[10px] mt-1 opacity-60">
                Staff must be clocked in, on shift, and accepting walk-ins.
              </p>
            </div>
          ) : (
            <RadioGroup value={selectedStaffId} onValueChange={setSelectedStaffId}>
              <div className="space-y-2">
                {turnOrderedStaff.map((member, index) => {
                  const isNext = index === 0;
                  const statusLabel =
                    member.status === 'busy' ? 'In Service' :
                    member.status === 'available' || member.status === 'idle' ? 'Available' :
                    member.status;
                  const statusDot =
                    member.status === 'busy' ? 'bg-blue-500' :
                    member.status === 'available' || member.status === 'idle' ? 'bg-green-500' :
                    'bg-slate-400';

                  return (
                    <Label
                      key={member.id}
                      htmlFor={`staff-assign-${member.id}`}
                      className={cn(
                        'flex items-center gap-4 p-3 border-2 rounded-xl cursor-pointer hover:bg-muted transition-all has-[:checked]:border-primary has-[:checked]:bg-primary/5',
                        member.id === walkIn.preferredStaffId && 'border-primary/20 shadow-sm'
                      )}
                    >
                      <RadioGroupItem value={member.id} id={`staff-assign-${member.id}`} />
                      <Avatar className="w-10 h-10 border shadow-sm">
                        <AvatarImage src={member.avatarUrl} className="object-cover" />
                        <AvatarFallback>{member.name.charAt(0)}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold">{member.name}</p>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', statusDot)} />
                          <p className="text-[10px] font-bold text-muted-foreground uppercase">{statusLabel}</p>
                          {member.id === walkIn.preferredStaffId && (
                            <span className="text-[9px] font-black uppercase text-primary tracking-widest">
                              · Client Pref
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        {isNext && (
                          <Badge className="h-5 text-[8px] uppercase bg-teal-500 border-none">
                            Up Next
                          </Badge>
                        )}
                        {!isNext && (
                          <Badge variant="outline" className="h-5 text-[8px] uppercase text-slate-400">
                            #{index + 1}
                          </Badge>
                        )}
                        {member.id === walkIn.preferredStaffId && !walkIn.waitForPreferredStaff && (
                          <Badge variant="destructive" className="h-5 text-[9px] uppercase">
                            Not Waiting
                          </Badge>
                        )}
                      </div>
                    </Label>
                  );
                })}
              </div>
            </RadioGroup>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleAssign}
            disabled={!selectedStaffId}
            className="font-bold h-11 px-8"
          >
            Assign & Notify
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};