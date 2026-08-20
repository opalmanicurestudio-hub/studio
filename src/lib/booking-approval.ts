import { doc, writeBatch, type Firestore } from 'firebase/firestore';

export type ApprovalOutcome = { ok: true; sentLink: boolean } | { ok: false; reason: string };

export type ApprovableAppointment = {
  id: string;
  clientName?: string;
  checkInToken?: string;
  voiceApproval?: string;
  voiceMeta?: {
    link?: string;
    clientEmail?: string;
    clientPhone?: string;
    downgradedFromInstant?: string;
    [k: string]: any;
  };
  [k: string]: any;
};

export const isAwaitingApproval = (apt: any): boolean =>
  !!apt && apt.voiceApproval === 'pending' && apt.status !== 'cancelled';

export const downgradeReasonLabel = (code?: string): string | null => {
  if (!code) return null;
  if (code === 'poor_history') return 'Held back — no-show history';
  if (code === 'outstanding_balance') return 'Held back — balance owing';
  if (code === 'service_requires_review') return 'This service always needs a yes';
  return 'Held back for review';
};

export async function approveBooking(
  firestore: Firestore | null | undefined,
  tenantId: string | null | undefined,
  apt: ApprovableAppointment,
  actorStaffId?: string | null,
  studioName?: string | null,
): Promise<ApprovalOutcome> {
  if (!firestore || !tenantId || !apt?.id) return { ok: false, reason: 'Missing studio or booking' };

  let sentLink = false;
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
          studioName: studioName || undefined,
        }),
      });
      sentLink = true;
    } catch {
      sentLink = false;
    }
  }

  try {
    const batch = writeBatch(firestore);
    batch.set(
      doc(firestore, `tenants/${tenantId}/appointments`, apt.id),
      {
        voiceApproval: 'approved',
        voiceApprovalAt: new Date().toISOString(),
        voiceApprovalBy: actorStaffId || null,
      },
      { merge: true },
    );
    await batch.commit();
    return { ok: true, sentLink };
  } catch {
    return { ok: false, reason: 'Could not save the approval' };
  }
}

export async function denyBooking(
  firestore: Firestore | null | undefined,
  tenantId: string | null | undefined,
  apt: ApprovableAppointment,
  actorStaffId?: string | null,
): Promise<ApprovalOutcome> {
  if (!firestore || !tenantId || !apt?.id) return { ok: false, reason: 'Missing studio or booking' };

  const nowISO = new Date().toISOString();
  const cancelPatch = {
    status: 'cancelled',
    cancelledAt: nowISO,
    cancellationReason: 'voice_booking_denied',
    cancellationAudit: {
      actorType: 'studio',
      actorId: actorStaffId || null,
      reason: 'voice_booking_denied',
      timestamp: nowISO,
    },
    voiceApproval: 'denied',
    voiceApprovalAt: nowISO,
    voiceApprovalBy: actorStaffId || null,
  };

  try {
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
    return { ok: true, sentLink: false };
  } catch {
    return { ok: false, reason: 'Could not release the slot' };
  }
}
