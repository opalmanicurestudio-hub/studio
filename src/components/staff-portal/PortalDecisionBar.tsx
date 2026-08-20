'use client';

import React, { useMemo, useState } from 'react';
import { AlertTriangle, Check, Loader } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { approveBooking, denyBooking, raiseIssue, isAwaitingApproval } from '@/lib/booking-approval';
import {
  resolveAuthority, resolveReasonList, responseClock,
  type AuthorityPolicy,
} from '@/lib/appointment-authority';

/**
 * PortalDecisionBar — the provider's half of appointment authority, on the
 * surface a provider actually works from.
 *
 * The planner is where a manager answers requests. Until this existed, a
 * provider whose whole day lives in the portal saw an unanswered booking
 * render as a perfectly ordinary card, with nothing to press. This gives them
 * the same three outcomes the planner has, decided by the same resolver, so a
 * person cannot have one authority on one screen and another somewhere else.
 */
export function PortalDecisionBar({
  appointment,
  staffMember,
  tenant,
  tenantId,
  firestore,
  allStaff,
  onDone,
}: {
  appointment: any;
  staffMember: any;
  tenant: any;
  tenantId: string;
  firestore: any;
  allStaff?: any[];
  onDone?: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [confirmDecline, setConfirmDecline] = useState(false);

  const policy: AuthorityPolicy | null = (tenant?.appointmentAuthority as AuthorityPolicy) || null;
  const authority = useMemo(() => resolveAuthority({
    isManager: ['owner', 'admin', 'manager'].includes(String(staffMember?.role || '')),
    employmentModel: staffMember?.employmentModel || null,
    decisionAuthority: staffMember?.decisionAuthority || null,
    role: staffMember?.role || null,
    policy,
  }), [staffMember, policy]);

  const reasons = useMemo(() => resolveReasonList(policy), [policy]);
  const awaiting = isAwaitingApproval(appointment);
  const clock = useMemo(() => responseClock(appointment, policy), [appointment, policy]);
  const openIssue = appointment?.issue?.status === 'open' ? appointment.issue : null;

  const actor = {
    uid: staffMember?.id,
    name: staffMember?.name,
    role: staffMember?.role || null,
    isManager: ['owner', 'admin', 'manager'].includes(String(staffMember?.role || '')),
  };

  const run = async (fn: () => Promise<any>, okTitle: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fn();
      if (res?.ok) {
        toast({ title: okTitle, description: res.message });
        setPicking(false);
        setConfirmDecline(false);
        if (onDone) onDone();
      } else if (res?.alreadyStatus) {
        toast({ title: 'Already answered', description: 'Nothing changed.' });
      } else {
        toast({ variant: 'destructive', title: res?.reason || 'Could not save that' });
      }
    } finally {
      setBusy(false);
    }
  };

  if (openIssue) {
    return (
      <div className="mt-2 flex items-start gap-2 rounded-xl border-2 border-destructive/40 bg-destructive/[0.05] px-3 py-2">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden="true" />
        <span className="min-w-0">
          <span className="block text-[11px] font-black uppercase tracking-widest text-destructive">With a manager</span>
          <span className="block truncate text-[11px] font-bold text-muted-foreground">{openIssue.label}</span>
        </span>
      </div>
    );
  }

  if (!awaiting) return null;

  if (picking) {
    return (
      <div className="mt-2 space-y-1.5 rounded-xl border-2 bg-white p-2">
        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Why can you not take it?</p>
        <div className="max-h-48 space-y-1 overflow-y-auto">
          {reasons.map(r => (
            <button
              key={r.code}
              type="button"
              disabled={busy}
              onClick={() => void run(
                () => raiseIssue(firestore, tenantId, appointment, r.code, null, actor, policy, allStaff || [], tenant?.userId || null),
                'Sent to a manager',
              )}
              className="w-full rounded-lg border-2 border-border bg-white px-2.5 py-2 text-left text-[11px] font-bold leading-snug text-foreground active:scale-[0.99] disabled:opacity-50"
            >
              {r.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setPicking(false)}
          className="w-full rounded-lg px-2 py-1.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground"
        >
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-1.5">
      {clock && (
        <p className={cn(
          'text-[11px] font-black uppercase tracking-widest',
          clock.overdue ? 'text-destructive' : 'text-muted-foreground',
        )}>
          {clock.overdue
            ? 'Overdue — a manager can see this'
            : clock.minutesLeft < 60
              ? `Respond within ${Math.max(1, clock.minutesLeft)} min`
              : `Respond by ${clock.due.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}
        </p>
      )}
      <div className="flex items-center gap-1.5">
      <button
        type="button"
        disabled={busy}
        aria-label={`Accept ${appointment?.clientName || 'this booking'}`}
        onClick={() => void run(
          () => approveBooking(firestore, tenantId, appointment, actor.uid, tenant?.name, actor.name),
          'Accepted',
        )}
        className="flex h-9 flex-1 items-center justify-center gap-1 rounded-xl bg-emerald-600 text-[10px] font-black uppercase tracking-widest text-white active:scale-95 disabled:opacity-50"
      >
        {busy ? <Loader className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          : <><Check className="h-3.5 w-3.5" aria-hidden="true" />Accept</>}
      </button>

      {authority === 'full' ? (
        confirmDecline ? (
          <>
            <button
              type="button" disabled={busy}
              onClick={() => void run(
                () => denyBooking(firestore, tenantId, appointment, actor.uid, actor.name, 'alternative'),
                'Declined',
              )}
              className="h-9 rounded-xl bg-destructive px-3 text-[10px] font-black uppercase tracking-widest text-white active:scale-95 disabled:opacity-50"
            >
              Yes
            </button>
            <button
              type="button"
              onClick={() => setConfirmDecline(false)}
              className="h-9 rounded-xl border-2 px-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground active:scale-95"
            >
              Keep
            </button>
          </>
        ) : (
          <button
            type="button" disabled={busy}
            aria-label={`Decline ${appointment?.clientName || 'this booking'}`}
            onClick={() => setConfirmDecline(true)}
            className="h-9 flex-1 rounded-xl border-2 text-[10px] font-black uppercase tracking-widest text-foreground active:scale-95 disabled:opacity-50"
          >
            Decline
          </button>
        )
      ) : (
        <button
          type="button" disabled={busy}
          aria-label={`Report an issue with ${appointment?.clientName || 'this booking'}`}
          onClick={() => setPicking(true)}
          className={cn(
            'h-9 flex-1 rounded-xl border-2 text-[10px] font-black uppercase tracking-widest text-foreground active:scale-95 disabled:opacity-50',
          )}
        >
          Report issue
        </button>
      )}
      </div>
    </div>
  );
}
