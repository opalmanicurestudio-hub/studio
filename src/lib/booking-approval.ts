import { addDoc, collection, doc, writeBatch, type Firestore } from 'firebase/firestore';
import { findReason, type AuthorityPolicy } from '@/lib/appointment-authority';
import { getAuth } from 'firebase/auth';

export type ApprovalResult =
  | { ok: true; message: string; nextStatus?: string | null }
  | { ok: false; reason: string; alreadyStatus?: string | null };

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
    if (!r) return 'Waiting on your yes';
    const low = r.toLowerCase();
    if (low.startsWith('shop default')) return 'Your shop reviews every booking';
    if (low.includes('overrides the shop rule')) return 'This service always needs a yes';
    if (low.includes('booking history')) return 'Held back - booking history';
    return r.length > 44 ? `${r.slice(0, 41)}...` : r;
  }
  const code = apt.voiceMeta?.downgradedFromInstant;
  if (!code) return apt.voiceApproval === 'pending' ? 'Waiting on your yes' : null;
  if (code === 'poor_history') return 'Held back - no-show history';
  if (code === 'outstanding_balance') return 'Held back - balance owing';
  if (code === 'service_requires_review') return 'This service always needs a yes';
  return 'Held back for review';
}

export function hasUsableCardOnFile(apt: any, client?: any): boolean {
  if (client && typeof client === 'object' && 'cardOnFile' in client) {
    const live = client.cardOnFile;
    return !!(live && live.customerId && live.paymentMethodId);
  }
  return apt?.hasCardOnFile === true;
}

export function acceptConsequenceLabel(apt: any, client?: any): string | null {
  if (!apt || apt.status !== 'requested') return null;
  const cents = Number(apt.depositAmountCents || 0);
  if (cents <= 0) return 'Accepting confirms it outright';
  return hasUsableCardOnFile(apt, client)
    ? `Accepting charges $${(cents / 100).toFixed(0)} to their card`
    : `Accepting sends a $${(cents / 100).toFixed(0)} pay link`;
}

async function sendCompletionLink(apt: ApprovableAppointment, studioName?: string | null): Promise<boolean> {
  const link = apt.voiceMeta?.link;
  if (!link) return false;
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
    return true;
  } catch {
    return false;
  }
}

/* The route now refuses anonymous callers, so every request carries the
 * signed-in staff member's ID token. The server reads the actor's NAME from
 * their staff document — what we send is proof of identity, not a claim. */
async function authHeaders(): Promise<Record<string, string>> {
  const base: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const user = getAuth().currentUser;
    if (!user) return base;
    const token = await user.getIdToken();
    return token ? { ...base, Authorization: `Bearer ${token}` } : base;
  } catch {
    return base;
  }
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
      headers: await authHeaders(),
      body: JSON.stringify({
        tenantId,
        appointmentId: apt.id,
        decision,
        ...(decision === 'decline' ? { declineOutcome: declineOutcome || 'alternative' } : {}),
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.ok !== true) {
      return {
        ok: false,
        reason: (data && data.error) || 'Could not record that decision',
        alreadyStatus: (data && data.alreadyStatus) || null,
      };
    }
    return {
      ok: true,
      message: data.message || (decision === 'accept' ? 'Accepted' : 'Declined'),
      nextStatus: data.status || (decision === 'accept' ? 'confirmed' : 'declined'),
    };
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
  const sentLink = await sendCompletionLink(apt, studioName);
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
      nextStatus: apt.status || 'confirmed',
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
    return { ok: true, nextStatus: 'cancelled', message: 'Declined - the time is free again. Give them a quick call.' };
  } catch {
    return { ok: false, reason: 'Could not release the slot' };
  }
}

/* Field-for-field the same row the decide route writes server-side, so a
 * report can read one collection and not care which channel answered. */
async function recordVoiceDecision(
  firestore: Firestore,
  tenantId: string,
  apt: ApprovableAppointment,
  action: 'accepted' | 'declined',
  resultStatus: string,
  actor: { uid?: string | null; name?: string | null; role?: string | null; isManager?: boolean },
): Promise<void> {
  try {
    const nowIso = new Date().toISOString();
    const requestedAtIso = String(apt.requestedAt || apt.createdAt || '');
    const requestedMs = requestedAtIso ? Date.parse(requestedAtIso) : NaN;
    await addDoc(collection(firestore, `tenants/${tenantId}/appointmentDecisions`), {
      tenantId,
      appointmentId: apt.id,
      clientId: apt.clientId || null,
      clientName: apt.clientName || null,
      serviceId: apt.serviceId || null,
      staffId: apt.staffId || null,
      startTime: apt.startTime || null,
      source: apt.source || null,
      channel: 'voice',
      action,
      declineOutcome: null,
      reasonCode: null,
      reason: null,
      priorStatus: apt.status || null,
      resultStatus,
      depositCents: Number(apt.depositAmountCents || 0),
      chargedOnFile: false,
      actorUid: actor.uid || null,
      actorName: actor.name || null,
      actorRole: actor.role || null,
      actorIsManager: !!actor.isManager,
      decidedAt: nowIso,
      requestedAt: requestedAtIso || null,
      responseSeconds: Number.isFinite(requestedMs)
        ? Math.max(0, Math.round((Date.parse(nowIso) - requestedMs) / 1000))
        : null,
    });
  } catch {
    /* the decision already stands; a missing row is not worth failing over */
  }
}

/**
 * A provider who cannot take a booking raises an issue. It does NOT cancel the
 * client's appointment — the first job is to solve the exception, not to lose
 * the booking. The flag rides on the appointment so a manager sees it in
 * context, and the same row goes to the decision ledger so raising an issue is
 * as measurable as answering a request.
 */
export async function raiseIssue(
  firestore: Firestore | null | undefined,
  tenantId: string | null | undefined,
  apt: ApprovableAppointment,
  reasonCode: string,
  note: string | null,
  actor: { uid?: string | null; name?: string | null; role?: string | null; isManager?: boolean },
  policy?: AuthorityPolicy | null,
): Promise<ApprovalResult> {
  if (!firestore || !tenantId || !apt?.id) return { ok: false, reason: 'Missing studio or booking' };
  const known = findReason(reasonCode, policy);
  if (!known) return { ok: false, reason: 'Pick a reason so this can be handled properly.' };
  if (apt.issue && apt.issue.status === 'open') {
    return { ok: false, reason: 'An issue is already open on this booking.', alreadyStatus: 'issue_open' };
  }

  const nowIso = new Date().toISOString();
  const issue = {
    code: known.code,
    label: known.label,
    note: (note || '').trim().slice(0, 300) || null,
    raisedByUid: actor.uid || null,
    raisedByName: actor.name || null,
    raisedAt: nowIso,
    status: 'open' as const,
    resolvedByUid: null,
    resolvedByName: null,
    resolvedAt: null,
    outcome: null,
  };

  try {
    const batch = writeBatch(firestore);
    batch.set(doc(firestore, `tenants/${tenantId}/appointments`, apt.id), { issue }, { merge: true });
    await batch.commit();
  } catch {
    return { ok: false, reason: 'Could not raise that — try again.' };
  }

  try {
    const requestedAtIso = String(apt.requestedAt || apt.createdAt || '');
    const requestedMs = requestedAtIso ? Date.parse(requestedAtIso) : NaN;
    await addDoc(collection(firestore, `tenants/${tenantId}/appointmentDecisions`), {
      tenantId,
      appointmentId: apt.id,
      clientId: apt.clientId || null,
      clientName: apt.clientName || null,
      serviceId: apt.serviceId || null,
      staffId: apt.staffId || null,
      startTime: apt.startTime || null,
      source: apt.source || null,
      channel: 'issue',
      action: 'issue_raised',
      declineOutcome: null,
      reasonCode: known.code,
      reasonLabel: known.label,
      reasonSource: known.source || 'builtin',
      reason: issue.note,
      priorStatus: apt.status || null,
      resultStatus: apt.status || null,
      depositCents: Number(apt.depositAmountCents || 0),
      chargedOnFile: false,
      decidedVia: null,
      actorUid: actor.uid || null,
      actorName: actor.name || null,
      actorRole: actor.role || null,
      actorIsManager: !!actor.isManager,
      decidedAt: nowIso,
      requestedAt: requestedAtIso || null,
      responseSeconds: Number.isFinite(requestedMs)
        ? Math.max(0, Math.round((Date.parse(nowIso) - requestedMs) / 1000))
        : null,
    });
  } catch {
    /* the issue is raised and visible; a missing ledger row is not worth failing over */
  }

  return {
    ok: true,
    nextStatus: apt.status || null,
    message: `Raised with a manager — ${apt.clientName || 'the client'} keeps their time for now.`,
  };
}

export type IssueOutcome = 'reassigned' | 'declined' | 'kept' | 'other';

/**
 * A manager closes an issue. Four ways out, in the order that protects the
 * client relationship best:
 *
 *   reassigned — someone else takes it. The client keeps their time and never
 *                needs to hear about any of this.
 *   kept       — the provider keeps it after all. The issue is recorded as
 *                dismissed rather than deleted, because "raised and overruled"
 *                is a different fact from "never raised."
 *   declined   — no coverage exists. This is the only path that costs the
 *                client their appointment, which is why it is last and why it
 *                writes a real cancellation rather than just closing a flag.
 *   other      — handled off-platform. Still recorded, still measurable.
 */
export async function resolveIssue(
  firestore: Firestore | null | undefined,
  tenantId: string | null | undefined,
  apt: ApprovableAppointment,
  outcome: IssueOutcome,
  actor: { uid?: string | null; name?: string | null; role?: string | null; isManager?: boolean },
  opts?: { newStaffId?: string | null; newStaffName?: string | null; note?: string | null },
): Promise<ApprovalResult> {
  if (!firestore || !tenantId || !apt?.id) return { ok: false, reason: 'Missing studio or booking' };
  /* The client SDK cannot enforce this on its own — appointment writes are
   * open to any staff member in the rules — so this is a guard, not a wall.
   * The rules should follow once issue resolution has settled. */
  if (!actor.isManager) return { ok: false, reason: 'Only a manager can close an issue.' };
  if (!apt.issue || apt.issue.status !== 'open') {
    return { ok: false, reason: 'There is no open issue on this booking.', alreadyStatus: apt.issue?.status || 'none' };
  }
  if (outcome === 'reassigned' && !opts?.newStaffId) {
    return { ok: false, reason: 'Pick who is taking it.' };
  }

  const nowIso = new Date().toISOString();
  const closed = {
    ...apt.issue,
    status: outcome === 'kept' ? 'dismissed' : 'resolved',
    resolvedByUid: actor.uid || null,
    resolvedByName: actor.name || null,
    resolvedAt: nowIso,
    outcome,
    resolutionNote: (opts?.note || '').trim().slice(0, 300) || null,
  };

  const patch: Record<string, any> = { issue: closed };
  if (outcome === 'reassigned') {
    patch.staffId = opts?.newStaffId;
    patch.reassignedFromStaffId = apt.staffId || null;
    patch.reassignedAt = nowIso;
    patch.reassignedBy = actor.uid || null;
  }
  if (outcome === 'declined') {
    patch.status = 'cancelled';
    patch.cancelledAt = nowIso;
    patch.cancellationReason = 'no_coverage_available';
    patch.cancellationAudit = {
      actorType: 'studio',
      actorId: actor.uid || null,
      reason: 'no_coverage_available',
      timestamp: nowIso,
    };
  }

  try {
    const batch = writeBatch(firestore);
    batch.set(doc(firestore, `tenants/${tenantId}/appointments`, apt.id), patch, { merge: true });
    if (outcome === 'declined' && apt.checkInToken) {
      batch.set(doc(firestore, 'appointmentCheckIns', apt.checkInToken), {
        status: 'cancelled',
        cancellationReason: 'no_coverage_available',
        tenantId,
      }, { merge: true });
    }
    await batch.commit();
  } catch {
    return { ok: false, reason: 'Could not save that — try again.' };
  }

  try {
    await addDoc(collection(firestore, `tenants/${tenantId}/appointmentDecisions`), {
      tenantId,
      appointmentId: apt.id,
      clientId: apt.clientId || null,
      clientName: apt.clientName || null,
      serviceId: apt.serviceId || null,
      staffId: outcome === 'reassigned' ? opts?.newStaffId || null : apt.staffId || null,
      previousStaffId: outcome === 'reassigned' ? apt.staffId || null : null,
      startTime: apt.startTime || null,
      source: apt.source || null,
      channel: 'issue',
      action: 'issue_resolved',
      declineOutcome: null,
      reasonCode: apt.issue.code || null,
      reasonLabel: apt.issue.label || null,
      reasonSource: null,
      reason: closed.resolutionNote,
      issueOutcome: outcome,
      priorStatus: apt.status || null,
      resultStatus: outcome === 'declined' ? 'cancelled' : apt.status || null,
      depositCents: Number(apt.depositAmountCents || 0),
      chargedOnFile: false,
      decidedVia: 'manager',
      actorUid: actor.uid || null,
      actorName: actor.name || null,
      actorRole: actor.role || null,
      actorIsManager: true,
      decidedAt: nowIso,
      requestedAt: apt.issue.raisedAt || null,
      responseSeconds: apt.issue.raisedAt
        ? Math.max(0, Math.round((Date.parse(nowIso) - Date.parse(String(apt.issue.raisedAt))) / 1000))
        : null,
    });
  } catch {
    /* the issue is closed and visible; a missing ledger row is not worth failing over */
  }

  const who = opts?.newStaffName || 'another provider';
  return {
    ok: true,
    nextStatus: outcome === 'declined' ? 'cancelled' : apt.status || null,
    message: outcome === 'reassigned'
      ? `Moved to ${who}. ${apt.clientName || 'The client'} keeps their time.`
      : outcome === 'kept'
        ? 'Kept as it stands — the provider has been told.'
        : outcome === 'declined'
          ? `No cover was available, so ${apt.clientName || 'the client'} has been cancelled. Give them a call.`
          : 'Closed — handled outside the app.',
  };
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
  if (channel === 'request') {
    const res = await decideViaRoute(tenantId, apt, 'accept', staffName || studioName);
    if (res.ok) await sendCompletionLink(apt, studioName);
    return res;
  }
  if (channel === 'voice') {
    if (!firestore) return { ok: false, reason: 'Missing studio or booking' };
    const res = await approveVoiceBooking(firestore, tenantId, apt, actorStaffId, studioName);
    if (res.ok) {
      await recordVoiceDecision(firestore, tenantId, apt, 'accepted', res.nextStatus || 'confirmed',
        { uid: actorStaffId, name: staffName || studioName, role: null, isManager: false });
    }
    return res;
  }
  return { ok: false, reason: 'That booking is not waiting on a decision', alreadyStatus: String(apt.status || '') };
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
    const res = await denyVoiceBooking(firestore, tenantId, apt, actorStaffId);
    if (res.ok) {
      await recordVoiceDecision(firestore, tenantId, apt, 'declined', 'cancelled',
        { uid: actorStaffId, name: staffName, role: null, isManager: false });
    }
    return res;
  }
  return { ok: false, reason: 'That booking is not waiting on a decision', alreadyStatus: String(apt.status || '') };
}
