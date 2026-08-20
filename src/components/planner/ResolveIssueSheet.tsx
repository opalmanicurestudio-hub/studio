'use client';

import React, { useState } from 'react';
import { AlertTriangle, ArrowRightLeft, CalendarClock, Check, Loader, UserX } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import type { CoverageCandidate } from '@/lib/appointment-coverage';
import type { IssueOutcome } from '@/lib/booking-approval';

export function ResolveIssueSheet({
  open,
  onOpenChange,
  appointment,
  raisedByName,
  coverage,
  busy,
  onResolve,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  appointment: any;
  raisedByName?: string;
  coverage: CoverageCandidate[];
  busy?: boolean;
  onResolve: (outcome: IssueOutcome, opts: { newStaffId?: string; newStaffName?: string; note?: string }) => void | Promise<void>;
}) {
  const [pickedStaff, setPickedStaff] = useState<string>('');
  const [note, setNote] = useState('');
  const [confirmDecline, setConfirmDecline] = useState(false);

  const issue = appointment?.issue || null;
  const depositCents = Number(appointment?.depositAmountCents || 0);
  const depositPaid = String(appointment?.depositStatus || '') === 'paid' && depositCents > 0;
  const isConfirmed = ['confirmed', 'servicing', 'pending_payment'].includes(String(appointment?.status || ''));
  const picked = coverage.find(c => c.id === pickedStaff) || null;

  const close = (v: boolean) => {
    onOpenChange(v);
    if (!v) { setPickedStaff(''); setNote(''); setConfirmDecline(false); }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="rounded-2xl border-2 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-black tracking-tight">
            <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
            {issue?.label || 'Issue raised'}
          </DialogTitle>
          <DialogDescription className="text-[12px] font-bold leading-snug text-muted-foreground">
            {raisedByName ? `${raisedByName} raised this` : 'Raised by a provider'}
            {appointment?.clientName ? ` on ${appointment.clientName}'s booking.` : '.'}
            {' '}Nothing has been cancelled.
          </DialogDescription>
        </DialogHeader>

        {issue?.note && (
          <p className="rounded-xl border-2 bg-muted/30 px-3 py-2 text-[12px] font-bold leading-snug text-foreground">
            {issue.note}
          </p>
        )}

        <div className="space-y-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            {coverage.length > 0 ? `${coverage.length} could cover this` : 'Nobody else can cover this'}
          </p>
          {coverage.length > 0 ? (
            <div className="max-h-[32dvh] space-y-1.5 overflow-y-auto pr-1">
              {coverage.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setPickedStaff(c.id)}
                  aria-pressed={pickedStaff === c.id}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-xl border-2 px-3 py-2 text-left transition-colors active:scale-[0.99]',
                    pickedStaff === c.id ? 'border-primary bg-primary/[0.06]' : 'border-border bg-white hover:bg-muted/40',
                  )}
                >
                  <Avatar className="h-7 w-7 shrink-0 rounded-lg">
                    <AvatarImage src={c.avatarUrl} className="object-cover" />
                    <AvatarFallback className="bg-primary/10 text-[10px] font-black text-primary">
                      {(c.name || '?').charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-black tracking-tight text-foreground">{c.name}</span>
                    <span className="block truncate text-[11px] font-bold text-muted-foreground">{c.note}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="rounded-xl border-2 border-dashed px-3 py-2.5 text-[12px] font-bold leading-snug text-muted-foreground">
              No qualified provider is free at this time. Moving it to another time is almost always better than losing the booking.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="resolve-note" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            Note (optional)
          </Label>
          <Textarea
            id="resolve-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={300}
            placeholder="Recorded on the booking, not sent to the client."
            className="rounded-xl border-2 text-[13px]"
          />
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col sm:gap-2">
          <Button
            disabled={!!busy || !picked}
            className="h-11 w-full rounded-xl font-black uppercase text-[10px] tracking-widest"
            onClick={() => picked && onResolve('reassigned', { newStaffId: picked.id, newStaffName: picked.name, note })}
          >
            {busy ? <Loader className="h-4 w-4 animate-spin" aria-hidden="true" />
              : <><ArrowRightLeft className="mr-2 h-3.5 w-3.5" aria-hidden="true" />Move to {picked ? picked.name : 'someone else'}</>}
          </Button>

          <Button
            variant="outline"
            disabled={!!busy}
            className="h-11 w-full rounded-xl border-2 font-black uppercase text-[10px] tracking-widest"
            onClick={() => onResolve('rescheduled', { note })}
          >
            <CalendarClock className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
            Move it to another time
          </Button>

          <Button
            variant="outline"
            disabled={!!busy}
            className="h-11 w-full rounded-xl border-2 font-black uppercase text-[10px] tracking-widest"
            onClick={() => onResolve('kept', { note })}
          >
            <Check className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
            Keep as it stands
          </Button>

          {!confirmDecline ? (
            <Button
              variant="ghost"
              disabled={!!busy}
              className="h-10 w-full rounded-xl font-black uppercase text-[10px] tracking-widest text-destructive"
              onClick={() => setConfirmDecline(true)}
            >
              <UserX className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
              No cover — cancel the client
            </Button>
          ) : (
            <div className="w-full space-y-2">
              <p className="text-[11px] font-bold leading-snug text-destructive">
                {isConfirmed
                  ? `${appointment?.clientName || 'This client'} has this in their calendar. They will be emailed and texted.`
                  : `${appointment?.clientName || 'This client'} will be told the time is not available.`}
                {depositPaid ? ` Their $${(depositCents / 100).toFixed(2)} deposit will be marked owed back.` : ''}
              </p>
              <div className="flex w-full items-center gap-2">
              <span className="flex-1 text-[11px] font-black uppercase tracking-widest text-destructive">
                Cancel {appointment?.clientName || 'the client'}?
              </span>
              <Button
                disabled={!!busy}
                className="h-10 rounded-xl bg-destructive px-3 font-black uppercase text-[10px] tracking-widest text-white"
                onClick={() => onResolve('declined', { note })}
              >
                Yes
              </Button>
              <Button
                variant="outline"
                className="h-10 rounded-xl border-2 px-3 font-black uppercase text-[10px] tracking-widest"
                onClick={() => setConfirmDecline(false)}
              >
                Keep
              </Button>
              </div>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
