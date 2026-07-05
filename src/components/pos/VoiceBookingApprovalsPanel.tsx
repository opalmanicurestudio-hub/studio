'use client';

/**
 * VoiceBookingApprovalsPanel — v1
 *
 * The Approve/Deny queue for approval-mode voice bookings. Each row is a
 * REAL appointment (status deposit_pending or confirmed) already holding
 * its slot — the calendar was protected the moment the caller said yes;
 * this panel controls only the paperwork:
 *
 *   APPROVE — deposit/forms required: sends the staged completion link
 *     (voiceMeta.link, via the existing send-completion-link route) and
 *     marks voiceApproval 'approved'. No link needed: just marks approved.
 *     The row disappears; the deposit webhook handles confirmed-flipping
 *     exactly as it does for every other booking.
 *   DENY — cancels the appointment (releasing the slot), mirrors the
 *     cancellation to appointmentCheckIns, voids the bookingCompletions
 *     record, and marks voiceApproval 'denied'. The client should then get
 *     a human call/text — the row shows their number for exactly that.
 *
 * Rows are self-describing via voiceMeta (service, provider, spoken time,
 * deposit, contact) — no joins needed. Pass callsById (as
 * VoiceCommandCenter does) and each row plays its own call recording
 * inline, so staff can hear the commitment before approving.
 *
 * Query is two equality filters (voiceApproval + status filtering done in
 * memory) — no composite index required.
 */

import React from 'react';
import {
  collection, query, where, onSnapshot, doc, writeBatch,
} from 'firebase/firestore';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import {
  CalendarCheck, Check, X, Loader, Phone, Wallet, FileText, Bot,
} from 'lucide-react';

type PendingBooking = {
  id: string;
  clientName?: string;
  clientId?: string;
  checkInToken?: string;
  status?: string;
  createdAt?: string;
  depositAmountCents?: number;
  retellCallId?: string;
  voiceMeta?: {
    serviceName?: string;
    providerName?: string;
    spoken?: string;
    link?: string;
    clientPhone?: string;
    clientEmail?: string;
    depositCents?: number;
    formsNeeded?: number;
  };
};

const safeRelativeTime = (iso?: string): string => {
  if (!iso) return '';
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return '';
  }
};

export function VoiceBookingApprovalsPanel({
  firestore,
  tenantId,
  tenant,
  currentStaffId,
  callsById,
  className,
}: {
  firestore: any;
  tenantId: string;
  tenant?: any;
  currentStaffId?: string;
  callsById?: Record<string, { recordingUrl?: string }>;
  className?: string;
}) {
  const { toast } = useToast();
  const [pending, setPending] = React.useState<PendingBooking[]>([]);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [confirmDenyId, setConfirmDenyId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!firestore || !tenantId) return;
    const q = query(
      collection(firestore, `tenants/${tenantId}/appointments`),
      where('voiceApproval', '==', 'pending'),
    );
    const unsub = onSnapshot(
      q,
      (snap: any) => {
        const list: PendingBooking[] = [];
        snap.forEach((d: any) => {
          const data = { id: d.id, ...(d.data() as any) };
          if (data.status !== 'cancelled') list.push(data);
        });
        list.sort(
          (a, b) =>
            new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
        );
        setPending(list);
      },
      () => { /* non-fatal */ },
    );
    return () => unsub();
  }, [firestore, tenantId]);

  const handleApprove = async (apt: PendingBooking) => {
    if (!firestore || !tenantId) return;
    setBusyId(apt.id);
    try {
      const link = apt.voiceMeta?.link;
      if (link) {
        try {
          await fetch('/api/notifications/send-completion-link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              link,
              clientName: apt.clientName,
              clientEmail: apt.voiceMeta?.clientEmail || '',
              clientPhone: apt.voiceMeta?.clientPhone || '',
              studioName: tenant?.name,
            }),
          });
        } catch {
          /* link stays available in voiceMeta; approval still proceeds */
        }
      }
      const batch = writeBatch(firestore);
      batch.set(
        doc(firestore, `tenants/${tenantId}/appointments`, apt.id),
        {
          voiceApproval: 'approved',
          voiceApprovalAt: new Date().toISOString(),
          voiceApprovalBy: currentStaffId || null,
        },
        { merge: true },
      );
      await batch.commit();
      toast({
        title: 'Booking approved',
        description: link
          ? `Secure link sent to ${apt.clientName || 'the client'}.`
          : `${apt.clientName || 'Client'} is confirmed.`,
      });
    } catch {
      toast({ variant: 'destructive', title: 'Could not approve — try again' });
    } finally {
      setBusyId(null);
    }
  };

  const handleDeny = async (apt: PendingBooking) => {
    if (!firestore || !tenantId) return;
    setBusyId(apt.id);
    try {
      const nowISO = new Date().toISOString();
      const cancelPatch = {
        status: 'cancelled',
        cancelledAt: nowISO,
        cancellationReason: 'voice_booking_denied',
        cancellationAudit: {
          actorType: 'studio',
          actorId: currentStaffId || null,
          reason: 'voice_booking_denied',
          timestamp: nowISO,
        },
        voiceApproval: 'denied',
        voiceApprovalAt: nowISO,
        voiceApprovalBy: currentStaffId || null,
      };
      const batch = writeBatch(firestore);
      batch.set(doc(firestore, `tenants/${tenantId}/appointments`, apt.id), cancelPatch, { merge: true });
      if (apt.checkInToken) {
        batch.set(doc(firestore, 'appointmentCheckIns', apt.checkInToken), cancelPatch, { merge: true });
        batch.set(
          doc(firestore, `tenants/${tenantId}/bookingCompletions`, apt.checkInToken),
          { status: 'void' },
          { merge: true },
        );
      }
      await batch.commit();
      setConfirmDenyId(null);
      toast({
        title: 'Booking denied — slot released',
        description: `Give ${apt.clientName || 'the client'} a quick call${apt.voiceMeta?.clientPhone ? ` at ${apt.voiceMeta.clientPhone}` : ''} so they're not left waiting.`,
      });
    } catch {
      toast({ variant: 'destructive', title: 'Could not deny — try again' });
    } finally {
      setBusyId(null);
    }
  };

  if (pending.length === 0) return null;

  return (
    <div className={cn('rounded-xl border border-amber-300 bg-amber-50/70 overflow-hidden', className)}>
      <div className="px-3.5 py-2 flex items-center gap-2 border-b border-amber-300/60">
        <CalendarCheck className="w-3.5 h-3.5 text-amber-700" />
        <p className="text-[11px] font-semibold text-amber-900 uppercase tracking-wide">
          Voice bookings awaiting approval · {pending.length}
        </p>
      </div>
      <div className="divide-y divide-amber-200/70">
        {pending.map((apt) => {
          const isBusy = busyId === apt.id;
          const isConfirmingDeny = confirmDenyId === apt.id;
          const meta = apt.voiceMeta || {};
          const deposit = meta.depositCents ?? apt.depositAmountCents ?? 0;
          const recording = apt.retellCallId
            ? callsById?.[apt.retellCallId]?.recordingUrl
            : undefined;
          return (
            <div key={apt.id} className="px-3.5 py-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-slate-900 truncate">
                    {apt.clientName || 'Unknown caller'}
                    {meta.clientPhone && (
                      <span className="font-normal text-slate-400 ml-1.5 inline-flex items-center gap-1">
                        <Phone className="w-2.5 h-2.5" /> {meta.clientPhone}
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-slate-700 mt-0.5">
                    {meta.spoken || `${meta.serviceName || 'Service'} · ${meta.providerName || ''}`}
                  </p>
                  <div className="flex items-center gap-2 flex-wrap mt-1">
                    <span className="text-[10px] font-medium text-slate-500 bg-white border border-amber-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                      <Bot className="w-2.5 h-2.5" /> Slot already held
                    </span>
                    {deposit > 0 && (
                      <span className="text-[10px] font-medium text-amber-800 bg-white border border-amber-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <Wallet className="w-2.5 h-2.5" /> ${(deposit / 100).toFixed(2)} deposit on approve
                      </span>
                    )}
                    {(meta.formsNeeded || 0) > 0 && (
                      <span className="text-[10px] font-medium text-slate-600 bg-white border border-amber-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <FileText className="w-2.5 h-2.5" /> {meta.formsNeeded} form{meta.formsNeeded !== 1 ? 's' : ''}
                      </span>
                    )}
                    <span className="text-[10px] text-amber-700">{safeRelativeTime(apt.createdAt)}</span>
                  </div>
                </div>
              </div>

              {recording && (
                <audio controls preload="none" src={recording} className="w-full h-9" />
              )}

              {!isConfirmingDeny ? (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    className="h-9 text-xs flex-1"
                    disabled={isBusy}
                    onClick={() => handleApprove(apt)}
                  >
                    {isBusy ? (
                      <Loader className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <>
                        <Check className="w-3.5 h-3.5 mr-1" />
                        {apt.voiceMeta?.link ? 'Approve & send link' : 'Approve'}
                      </>
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 text-xs border-red-200 text-red-600 hover:bg-red-50"
                    disabled={isBusy}
                    onClick={() => setConfirmDenyId(apt.id)}
                  >
                    <X className="w-3.5 h-3.5 mr-1" /> Deny
                  </Button>
                </div>
              ) : (
                <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 space-y-2">
                  <p className="text-[11px] text-red-700">
                    Deny releases the slot and cancels this booking. The client was told they're
                    penciled in — plan to call or text them right after.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs flex-1 border-red-300 text-red-700 hover:bg-red-100"
                      disabled={isBusy}
                      onClick={() => handleDeny(apt)}
                    >
                      {isBusy ? <Loader className="w-3 h-3 animate-spin" /> : 'Yes, deny & release'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-xs"
                      onClick={() => setConfirmDenyId(null)}
                    >
                      Keep it
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
