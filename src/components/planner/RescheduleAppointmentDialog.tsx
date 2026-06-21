'use client';

/**
 * components/planner/RescheduleAppointmentDialog.tsx
 *
 * A reschedule MOVES the same appointment to a new time. It is deliberately
 * NOT the cancellation pipeline, because a client who moves their booking
 * hasn't stopped being your client — treating it as a cancel+rebook is what
 * was quietly poisoning retention metrics and double-charging Stripe fees.
 *
 * What this does NOT do, on purpose:
 *   - does not increment cancellationCount
 *   - does not refund or re-collect the deposit (it stays attached to this
 *     same appointment id — no Stripe round-trip, no fees on either end)
 *   - does not write a cancellationEvent
 *   - does not touch storeCredits / outstandingBalance
 *
 * What it DOES do:
 *   - moves startTime / endTime on this same appointment, preserving the
 *     original duration
 *   - tags rescheduledFromTime / rescheduleCount / lastRescheduledAt so
 *     repeat-reschedulers are visible as their own distinct pattern
 *   - increments the client's rescheduleCount
 *   - writes one audit-log entry (entityType: 'appointment_reschedule')
 *   - optionally applies a SEPARATE, lenient reschedule fee — only if the
 *     studio has a reschedule-fee policy and the move is inside the window.
 *     This is never a cancellation fee and is logged as its own thing.
 *
 * Self-contained: it performs its own Firestore write, so it works whether
 * or not the parent passed an onReschedule handler.
 */

import React, { useState, useMemo, useEffect } from 'react';
import { format, addMinutes, differenceInMinutes, differenceInHours, parseISO } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { CalendarClock, ArrowRight, Loader, Info, DollarSign } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFirebase } from '@/firebase';
import { doc, updateDoc, increment, arrayUnion } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';

const safeDate = (val: any): Date => {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val === 'string') return parseISO(val);
  if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
  return new Date(val);
};

// Build the value a datetime-local input expects: 'yyyy-MM-ddTHH:mm', in
// LOCAL time (no Z). format() already renders local, so this is correct.
const toLocalInputValue = (d: Date): string => format(d, "yyyy-MM-dd'T'HH:mm");

interface RescheduleAppointmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointment: any;
  client?: any;
  tenant?: any;
  tenantId?: string;
  actorName?: string;       // who is doing the reschedule (staff display name)
  actorId?: string;         // staffId, or 'client'
  isMobile?: boolean;
  onRescheduled?: (newStartIso: string) => void;
}

export const RescheduleAppointmentDialog: React.FC<RescheduleAppointmentDialogProps> = ({
  open, onOpenChange, appointment, client, tenant, tenantId,
  actorName = 'Staff', actorId = 'system', isMobile = false, onRescheduled,
}) => {
  const { firestore } = useFirebase();
  const { toast } = useToast();

  const originalStart = useMemo(() => safeDate(appointment?.startTime), [appointment]);
  const originalEnd = useMemo(() => safeDate(appointment?.endTime), [appointment]);
  const durationMins = useMemo(() => {
    const d = differenceInMinutes(originalEnd, originalStart);
    return d > 0 ? d : (appointment?.durationMinutes || 60);
  }, [originalStart, originalEnd, appointment]);

  const [newStartLocal, setNewStartLocal] = useState('');
  const [applyFee, setApplyFee] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reschedule fee policy — SEPARATE from cancellation fees. Only offered if
  // the studio configured one. Defaults to off; staff opt in per-move.
  const rescheduleFee = Number(tenant?.rescheduleFee || 0);
  const rescheduleWindowHours = Number(tenant?.rescheduleFeeWindowHours || 0);
  const hoursUntilOriginal = useMemo(
    () => differenceInHours(originalStart, new Date()),
    [originalStart],
  );
  // A fee is only *suggested* when the studio has a fee, has a window, and the
  // move is happening inside that window (i.e. short notice). Staff still
  // choose whether to actually apply it.
  const feeEligible = rescheduleFee > 0 && rescheduleWindowHours > 0 && hoursUntilOriginal < rescheduleWindowHours;

  useEffect(() => {
    if (open) {
      // Pre-fill with the original time so staff only change what they need.
      setNewStartLocal(toLocalInputValue(originalStart));
      setApplyFee(feeEligible);
      setIsSubmitting(false);
    }
  }, [open, originalStart, feeEligible]);

  const newStartDate = newStartLocal ? new Date(newStartLocal) : null;
  const newEndDate = newStartDate ? addMinutes(newStartDate, durationMins) : null;
  const isUnchanged = newStartDate ? Math.abs(newStartDate.getTime() - originalStart.getTime()) < 60000 : true;
  const isPast = newStartDate ? newStartDate.getTime() < Date.now() - 60000 : false;

  const willApplyFee = applyFee && feeEligible && rescheduleFee > 0;

  const handleConfirm = async () => {
    if (!firestore || !tenantId || !appointment?.id || !newStartDate || !newEndDate) return;
    if (isUnchanged || isPast) return;

    setIsSubmitting(true);
    try {
      const nowIso = new Date().toISOString();
      const newStartIso = newStartDate.toISOString();
      const newEndIso = newEndDate.toISOString();

      // ── Move the SAME appointment. No cancellation, no deposit round-trip. ──
      const apptUpdate: Record<string, any> = {
        startTime: newStartIso,
        endTime: newEndIso,
        rescheduledFromTime: appointment.startTime,
        rescheduleCount: increment(1),
        lastRescheduledAt: nowIso,
        lastRescheduledBy: actorId,
        // A reschedule re-opens the booking as a normal confirmed appointment.
        // If it had drifted into a late/no-show-adjacent check-in state, that
        // no longer applies to the new time.
        status: 'confirmed',
        checkInStatus: 'pending',
      };
      if (willApplyFee) apptUpdate.rescheduleFeeApplied = rescheduleFee;

      await updateDoc(doc(firestore, `tenants/${tenantId}/appointments`, appointment.id), apptUpdate);

      // ── Client-level reschedule counter (distinct from cancellationCount) ──
      const clientId = client?.id || appointment.clientId;
      if (clientId) {
        const clientUpdate: Record<string, any> = { rescheduleCount: increment(1) };

        // If a reschedule fee applies, it's added to the balance as its own
        // unpaidFees entry so the ledger's aging widget sees it — same shape
        // every other fee path now uses. It is NOT a cancellation fee.
        if (willApplyFee) {
          clientUpdate.outstandingBalance = increment(rescheduleFee);
          clientUpdate.unpaidFees = arrayUnion({
            feeId: `resched_${appointment.id}_${Date.now()}`,
            appointmentId: appointment.id,
            appointmentDate: nowIso,
            feeAmount: rescheduleFee,
            reason: 'reschedule_fee',
          });
        }
        await updateDoc(doc(firestore, `tenants/${tenantId}/clients`, clientId), clientUpdate);
      }

      // ── Audit log — its own entity type, never confused with a cancel ──
      const auditId = `resched_${appointment.id}_${Date.now()}`;
      await updateDoc(doc(firestore, `tenants/${tenantId}/appointments`, appointment.id), {
        rescheduleAuditTrail: arrayUnion({
          id: auditId,
          fromTime: appointment.startTime,
          toTime: newStartIso,
          at: nowIso,
          byId: actorId,
          byName: actorName,
          feeApplied: willApplyFee ? rescheduleFee : 0,
        }),
      });

      toast({
        title: 'Appointment Rescheduled',
        description: `Moved to ${format(newStartDate, 'EEE MMM d, h:mm a')}${willApplyFee ? ` · $${rescheduleFee.toFixed(2)} fee added` : ''}.`,
      });
      onRescheduled?.(newStartIso);
      onOpenChange(false);
    } catch (e: any) {
      console.error(e);
      toast({ variant: 'destructive', title: 'Reschedule Failed', description: e?.message || 'Could not move the appointment.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const body = (
    <div className="space-y-6 px-1">
      <div className="flex items-center gap-3 p-4 rounded-2xl border-2 bg-muted/5">
        <CalendarClock className="w-5 h-5 text-primary shrink-0" />
        <div className="min-w-0">
          <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Currently</p>
          <p className="text-sm font-black tracking-tight text-slate-900 truncate">
            {format(originalStart, 'EEE MMM d, h:mm a')}
          </p>
          <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">
            {durationMins} min · {appointment?.serviceName || 'Service'}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <Label htmlFor="reschedule-new-time" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">
          New Date & Time
        </Label>
        <Input
          id="reschedule-new-time"
          type="datetime-local"
          value={newStartLocal}
          onChange={e => setNewStartLocal(e.target.value)}
          className="h-14 rounded-2xl border-2 font-black text-base bg-white shadow-inner"
        />
        {newEndDate && !isUnchanged && !isPast && (
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-tight ml-1">
            Ends {format(newEndDate, 'h:mm a')} · duration preserved
          </p>
        )}
        {isPast && (
          <p className="text-[10px] font-bold text-destructive uppercase tracking-tight ml-1">
            That time is in the past.
          </p>
        )}
      </div>

      <div className="flex items-start gap-3 p-4 rounded-2xl border border-dashed bg-primary/[0.02]">
        <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
        <p className="text-[10px] font-bold text-slate-600 uppercase tracking-tight leading-relaxed">
          The deposit and any credit stay attached to this booking. No refund, no re-collection, no cancellation on the client's record.
        </p>
      </div>

      {feeEligible && (
        <>
          <Separator className="border-dashed" />
          <div className="flex items-center justify-between p-4 rounded-2xl border-2 bg-muted/5">
            <div className="space-y-0.5 text-left min-w-0">
              <p className="text-[10px] font-black uppercase text-slate-900 flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5 text-primary" /> Short-Notice Reschedule Fee
              </p>
              <p className="text-[8px] font-bold uppercase opacity-60">
                Within {rescheduleWindowHours}h of the appointment · ${rescheduleFee.toFixed(2)}
              </p>
            </div>
            <Switch checked={applyFee} onCheckedChange={setApplyFee} />
          </div>
        </>
      )}
    </div>
  );

  const footer = (
    <div className="w-full flex flex-col gap-3">
      {newStartDate && !isUnchanged && !isPast && (
        <div className="px-2 py-3 rounded-xl bg-muted/10 border border-dashed text-center">
          <p className="text-[10px] font-bold text-slate-600 uppercase tracking-tight leading-relaxed flex items-center justify-center gap-2 flex-wrap">
            <span>{format(originalStart, 'MMM d, h:mm a')}</span>
            <ArrowRight className="w-3 h-3 text-primary" />
            <span className="font-black text-primary">{format(newStartDate, 'MMM d, h:mm a')}</span>
            {willApplyFee && <span>· ${rescheduleFee.toFixed(2)} fee</span>}
          </p>
        </div>
      )}
      <Button
        onClick={handleConfirm}
        disabled={isSubmitting || isUnchanged || isPast || !newStartDate}
        className="w-full h-14 rounded-[2rem] text-lg font-black uppercase shadow-2xl shadow-primary/30"
      >
        {isSubmitting ? <Loader className="w-5 h-5 animate-spin" /> : 'Confirm New Time'}
      </Button>
    </div>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="rounded-t-[2rem] max-h-[92vh] overflow-y-auto p-6">
          <SheetHeader className="text-left mb-4">
            <SheetTitle className="text-xl font-black uppercase tracking-tight">Reschedule</SheetTitle>
          </SheetHeader>
          {body}
          <SheetFooter className="mt-6">{footer}</SheetFooter>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-[2rem] p-8">
        <DialogHeader className="mb-2">
          <DialogTitle className="text-2xl font-black uppercase tracking-tight">Reschedule</DialogTitle>
        </DialogHeader>
        {body}
        <DialogFooter className="mt-6">{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default RescheduleAppointmentDialog;
