import { doc, writeBatch, type Firestore } from 'firebase/firestore';

export type ApprovalResult = { ok: true; message: string } | { ok: false; reason: string };

export type ApprovableAppointment = {
  id: string;
  tenantId?: string;
  clientName?: string;
  status?: string;
  checkInStatus?: string;
  checkInToken?: string;
  voiceApproval?: string;
  source?: string;
  bookingReason?: string;
  hasCardOnFile?: boolean;
  depositAmountCents?: number;
  requestExpiresAt?: string | null;
  voiceMeta?: {
    link?: string;
    clientEmail?: string;
    clientPhone?: string;
    downgradedFromInstant?: string;
    [k: string]: any;
  };
  [k: string]: any;
};

const DEAD_STATUSES = ['cancelled', 'declined', 'expired', 'no_show'];

export const isDeadAppointment = (apt: any): boolean =>
  !!apt && (DEAD_STATUSES.includes(String(apt.status || '')) || apt.checkInStatus === 'auto_cancelled');

export type ApprovalChannel = 'request' | 'voice' | null;

export function approvalChannel(apt: any): ApprovalChannel {
  if (!apt || isDeadAppointment(apt)) return null;
  if (apt.status === 'requested') return 'request';
  if (apt.voiceApproval === 'pending') return 'voice';
  return null;
}

export const isAwaitingApproval = (apt: any): boolean => approvalChannel(apt) !== null;

export function holdReasonLabel(apt: any): string | null {
  if (!apt) return null;
  if (apt.status === 'requested') {
    const r = String(apt.bookingReason || '').trim();
    if (r) return r.length > 64 ? `${r.slice(0, 61)}...` : r;
    return 'Waiting on your yes';
  }
  const code = apt.voiceMeta?.downgradedFromInstant;
  if (!code) return apt.voiceApproval === 'pending' ? 'Waiting on your yes' : null;
  if (code === 'poor_history') return 'Held back - no-show history';
  if (code === 'outstanding_balance') return 'Held back - balance owing';
  if (code === 'service_requires_review') return 'This service always needs a yes';
  return 'Held back for review';
}

export function acceptConsequenceLabel(apt: any): string | null {
  if (!apt || apt.status !== 'requested') return null;
  const cents = Number(apt.depositAmountCents || 0);
  if (cents <= 0) return 'Accepting confirms it outright';
  return apt.hasCardOnFile
    ? `Accepting charges $${(cents / 100).toFixed(0)} to their card`
    : `Accepting sends a $${(cents / 100).toFixed(0)} pay link`;
}

async function decideViaRoute(
  tenantId: string,
  apt: ApprovableAppointment,
  decision: 'accept' | 'decline',
  staffName?: string | null,
  declineOutcome?: 'alternative' | 'final',
): Promise<ApprovalResult> {
  try {
    const res = await fetch('/api/appointments/decide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId,
        appointmentId: apt.id,
        decision,
        staffName: staffName || 'The studio',
        ...(decision === 'decline' ? { declineOutcome: declineOutcome || 'alternative' } : {}),
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.ok !== true) {
      return { ok: false, reason: (data && data.error) || 'Could not record that decision' };
    }
    return { ok: true, message: data.message || (decision === 'accept' ? 'Accepted' : 'Declined') };
  } catch {
    return { ok: false, reason: 'No connection - nothing changed' };
  }
}

async function approveVoiceBooking(
  firestore: Firestore,
  tenantId: string,
  apt: ApprovableAppointment,
  actorStaffId?: string | null,
  studioName?: string | null,
): Promise<ApprovalResult> {
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
    return {
      ok: true,
      message: sentLink
        ? 'Accepted - secure link sent to the client.'
        : `Accepted - ${apt.clientName || 'the client'} is confirmed.`,
    };
  } catch {
    return { ok: false, reason: 'Could not save the approval' };
  }
}

async function denyVoiceBooking(
  firestore: Firestore,
  tenantId: string,
  apt: ApprovableAppointment,
  actorStaffId?: string | null,
): Promise<ApprovalResult> {
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
    return { ok: true, message: 'Declined - the time is free again. Give them a quick call.' };
  } catch {
    return { ok: false, reason: 'Could not release the slot' };
  }
}

export async function approveBooking(
  firestore: Firestore | null | undefined,
  tenantId: string | null | undefined,
  apt: ApprovableAppointment,
  actorStaffId?: string | null,
  studioName?: string | null,
  staffName?: string | null,
): Promise<ApprovalResult> {
  if (!tenantId || !apt?.id) return { ok: false, reason: 'Missing studio or booking' };
  const channel = approvalChannel(apt);
  if (channel === 'request') return decideViaRoute(tenantId, apt, 'accept', staffName || studioName);
  if (channel === 'voice') {
    if (!firestore) return { ok: false, reason: 'Missing studio or booking' };
    return approveVoiceBooking(firestore, tenantId, apt, actorStaffId, studioName);
  }
  return { ok: false, reason: 'That booking is not waiting on a decision' };
}

export async function denyBooking(
  firestore: Firestore | null | undefined,
  tenantId: string | null | undefined,
  apt: ApprovableAppointment,
  actorStaffId?: string | null,
  staffName?: string | null,
  declineOutcome?: 'alternative' | 'final',
): Promise<ApprovalResult> {
  if (!tenantId || !apt?.id) return { ok: false, reason: 'Missing studio or booking' };
  const channel = approvalChannel(apt);
  if (channel === 'request') return decideViaRoute(tenantId, apt, 'decline', staffName, declineOutcome);
  if (channel === 'voice') {
    if (!firestore) return { ok: false, reason: 'Missing studio or booking' };
    return denyVoiceBooking(firestore, tenantId, apt, actorStaffId);
  }
  return { ok: false, reason: 'That booking is not waiting on a decision' };
}
