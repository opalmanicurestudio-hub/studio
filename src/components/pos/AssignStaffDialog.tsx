'use client';

/**
 * AssignStaffDialog — v2
 *
 * v2 — THE CRASH. This component broke the rules of hooks, and the result was a
 * hard client-side exception every single time the dialog opened.
 *
 *     const { services, shifts } = useInventory();   // hook
 *     const [selectedStaffId, setSelectedStaffId]    // hook
 *     useEffect(...)                                 // hook
 *
 *     if (!walkIn) return null;                      // ← EARLY RETURN
 *
 *     const turnOrderedStaff = useMemo(...)          // hook
 *     useEffect(...)                                 // hook
 *
 * While the dialog is closed, `walkIn` is null, the component returns at the
 * early exit, and React records three hooks. The moment a card is tapped,
 * `walkIn` becomes an object, the early return is skipped, and the render calls
 * five. React compares the two and throws:
 *
 *     Rendered more hooks than during the previous render.
 *
 * There is no way to guard against this at the call site and no input that
 * avoids it — hooks must all be called, in the same order, on every render, and
 * an early return placed above any of them makes the component unrenderable the
 * first time its guard flips. The fix is the standard one: every hook runs
 * unconditionally, and `if (!walkIn) return null` moves below all of them.
 *
 * WHY IT HAD NEVER BEEN SEEN. This dialog is only reachable from Assign Session
 * on a card in the Waiting lane, and until the walk-in engine was fixed to
 * create rows as `waiting`, nothing ever sat there — every guest was born
 * `notified` whenever any provider happened to be free, which on a quiet day is
 * every guest. The queue landing in Waiting is what made this path reachable.
 *
 * ALSO FIXED
 *   - `services.find(...)` and `walkIn.serviceIds.map(...)` were both unguarded.
 *     `services` comes from context and is null while inventory loads; a row
 *     written before serviceIds existed has no array. Either one throws in the
 *     same way the hook order did.
 *   - `walkIn.assignedStaffId` — the engine writes `staffId`. Same mismatch that
 *     made the Called card render blank. Reads both, staffId first.
 *   - `walkIn.waitForPreferredStaff` — the kiosk and /api/walkins write
 *     `waitForPreferred`. The switch was reading a field nothing writes, so it
 *     always showed off no matter what the guest chose at the kiosk. Reads both.
 *   - `preferredStaff.name.split(' ')[0]` and `member.name.charAt(0)` threw on a
 *     staff record with no name.
 *   - The auto-select effect read `selectedStaffId` without listing it, so it
 *     worked off a stale closure. It now runs off the dialog opening only, which
 *     is the behaviour it was reaching for.
 *
 * KNOWN DIVERGENCE, left alone deliberately — see the note on turnOrderedStaff.
 */

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

const firstNameOf = (val: any): string => String(val || '').trim().split(/\s+/)[0] || '';
const initialOf = (val: any): string => (String(val || '').trim().charAt(0) || 'S').toUpperCase();

export const AssignStaffDialog: React.FC<AssignStaffDialogProps> = ({
  open, onOpenChange, walkIn, staff, onAssign, onToggleWaitForStaff,
}) => {
  const { services, shifts } = useInventory();
  const [selectedStaffId, setSelectedStaffId] = useState('');

  const w = walkIn as any;

  /**
   * `staffId` first. The engine (api/walkins) and the POS terminal both write it;
   * only the POS ever wrote `assignedStaffId`, and reading that one alone is the
   * mismatch that made the Called card disappear.
   */
  const alreadyAssignedId = w?.staffId || w?.assignedStaffId || '';

  /**
   * The kiosk records `waitForPreferred`. This dialog was reading
   * `waitForPreferredStaff`, which nothing in the application writes — so a guest
   * who explicitly chose to hold out for one provider showed up here as not
   * waiting, and the "Not Waiting" badge below contradicted her actual choice.
   */
  const isWaitingForPreferred = w?.waitForPreferred === true || w?.waitForPreferredStaff === true;

  useEffect(() => {
    if (walkIn) {
      const initial = (w?.preferredStaffId && isWaitingForPreferred) ? String(w.preferredStaffId) : '';
      setSelectedStaffId(alreadyAssignedId || initial);
    } else {
      setSelectedStaffId('');
    }
  }, [walkIn, alreadyAssignedId, isWaitingForPreferred, w?.preferredStaffId]);

  const personServices = useMemo(() => {
    // Both halves were unguarded. `services` is null while inventory loads, and a
    // row can predate serviceIds entirely.
    const ids: string[] = Array.isArray(w?.serviceIds)
      ? w.serviceIds
      : (w?.serviceId ? [w.serviceId] : []);
    return ids
      .map(id => (services || []).find((s: Service) => s.id === id)?.name)
      .filter(Boolean)
      .join(', ');
  }, [w?.serviceIds, w?.serviceId, services]);

  const todayStr = format(new Date(), 'yyyy-MM-dd');

  /**
   * Turn order, mirroring the staff portal's WalkInLeaderboard:
   *   1. on shift today (not cancelled or draft)
   *   2. acceptingWalkIns !== false
   *   3. clocked in (active) and not on break
   *   4. 'idle', 'available' or 'busy' — busy meaning finishing up
   *   5. sorted by lastWalkInCompletedAt ascending (fair-play rotation)
   *
   * KNOWN DIVERGENCE: requirement 1 is stricter than the POS terminal's
   * handleAssignNext, which does not consult shifts at all and excludes 'busy'.
   * So AUTO-TURN can seat a provider this dialog would not offer, and vice
   * versa. That is the same class of problem as the queue having had two
   * comparators, and it wants one shared eligibility helper — but changing which
   * providers are assignable is a floor-policy decision, not a bug fix, so it is
   * left as-is and flagged rather than quietly altered here.
   */
  const turnOrderedStaff = useMemo(() => {
    if (!staff) return [];
    const todayShiftStaffIds = new Set(
      (shifts || [])
        .filter((s: any) => s.date === todayStr && s.status !== 'cancelled' && s.status !== 'draft')
        .map((s: any) => s.staffId)
    );
    return [...staff]
      .filter(s =>
        todayShiftStaffIds.has(s.id) &&
        s.active &&
        !s.onBreak &&
        (s as any).acceptingWalkIns !== false
      )
      .sort((a, b) => {
        const aLast = (a as any).lastWalkInCompletedAt
          ? new Date((a as any).lastWalkInCompletedAt).getTime() : 0;
        const bLast = (b as any).lastWalkInCompletedAt
          ? new Date((b as any).lastWalkInCompletedAt).getTime() : 0;
        return aLast - bLast;
      });
  }, [staff, shifts, todayStr]);

  /**
   * Auto-select whoever is up next when the dialog opens. Keyed on `open` and the
   * row's id rather than on selectedStaffId, which the previous version read
   * without listing as a dependency and therefore read stale.
   */
  useEffect(() => {
    if (!open) return;
    if (alreadyAssignedId) return;
    if (turnOrderedStaff.length === 0) return;
    setSelectedStaffId(prev => prev || turnOrderedStaff[0].id);
  }, [open, w?.id, alreadyAssignedId, turnOrderedStaff]);

  const preferredStaff = (staff || []).find(s => s.id === w?.preferredStaffId);

  const handleAssign = () => {
    if (walkIn && selectedStaffId) onAssign(walkIn.id, selectedStaffId);
  };

  // Below every hook. This is the whole fix.
  if (!walkIn) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Assign Staff to {w?.customerName || w?.clientName || 'Walk-in guest'}</DialogTitle>
          <DialogDescription>
            {personServices ? `Requested service: ${personServices}.` : 'No service recorded — check with the guest.'}
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
          {preferredStaff && (
            <div className={cn(
              'flex items-center justify-between rounded-lg border p-3',
              preferredStaff.active ? 'bg-primary/5 border-primary/20' : 'bg-muted/50 border-dashed opacity-60'
            )}>
              <div className="space-y-0.5">
                <Label htmlFor="wait-for-preferred" className="font-bold">
                  Wait for {firstNameOf(preferredStaff.name) || 'their provider'}?
                </Label>
                {!preferredStaff.active && (
                  <p className="text-[10px] text-destructive uppercase font-black">Not Clocked In</p>
                )}
              </div>
              <Switch
                id="wait-for-preferred"
                checked={isWaitingForPreferred}
                onCheckedChange={checked => onToggleWaitForStaff(walkIn.id, checked)}
              />
            </div>
          )}

          {turnOrderedStaff.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground border-2 border-dashed rounded-xl">
              <Users className="w-8 h-8 mx-auto mb-2 opacity-20" />
              <p className="font-bold">No available providers accepting walk-ins.</p>
              <p className="text-[10px] mt-1 opacity-60">
                Staff must be on a published shift today, clocked in, off break, and accepting walk-ins.
              </p>
            </div>
          ) : (
            <RadioGroup value={selectedStaffId} onValueChange={setSelectedStaffId}>
              <div className="space-y-2">
                {turnOrderedStaff.map((member, index) => {
                  const isNext = index === 0;
                  const isPreferred = member.id === w?.preferredStaffId;
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
                        isPreferred && 'border-primary/20 shadow-sm'
                      )}
                    >
                      <RadioGroupItem value={member.id} id={`staff-assign-${member.id}`} />
                      <Avatar className="w-10 h-10 border shadow-sm">
                        <AvatarImage src={member.avatarUrl} className="object-cover" />
                        <AvatarFallback>{initialOf(member.name)}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold">{member.name || 'Provider'}</p>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', statusDot)} />
                          <p className="text-[10px] font-bold text-muted-foreground uppercase">{statusLabel}</p>
                          {isPreferred && (
                            <span className="text-[9px] font-black uppercase text-primary tracking-widest">
                              &middot; Client Pref
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        {isNext ? (
                          <Badge className="h-5 text-[8px] uppercase bg-teal-500 border-none">
                            Up Next
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="h-5 text-[8px] uppercase text-slate-400">
                            #{index + 1}
                          </Badge>
                        )}
                        {isPreferred && !isWaitingForPreferred && (
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
            Assign &amp; Notify
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
