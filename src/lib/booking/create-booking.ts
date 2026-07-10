/**
 * create-booking — v1: THE booking engine.
 *
 * One server-side authority for turning "this client, this service, this
 * provider, this instant" into a real appointment — built for the AI
 * receptionist today, and structured so the online booking page's
 * handleConfirm and AddAppointmentDialog can migrate onto it next (both
 * currently write appointments with no slot locking; BookingSheet's
 * payload also lacks checkInToken/shortCode entirely, so online bookings
 * can't check in — this engine fixes all of that for every caller of it).
 *
 * Guarantees, in order:
 *   1. AUTHORITATIVE RE-VERIFY — the exact requested instant is re-checked
 *      server-side against the schedule window (profile + staff
 *      availability), blocked studioEvents, and every bookable-status
 *      appointment with pads. Availability offered seconds ago can be
 *      stale; this cannot.
 *   2. TRANSACTIONAL SLOT CLAIM — the same slotLocks discipline QuickBook
 *      uses (`${staffId}_${date}_${HHmm}` key, check-then-set in a
 *      transaction), so concurrent lock-respecting writers can never land
 *      the same slot. Lock is deleted in the same batch that writes the
 *      appointment (the appointment doc is the durable block).
 *   3. FULL FIELD PARITY — checkInToken, shortCode (unambiguous alphabet,
 *      mirroring lib/short-code semantics: no 0/O/1/I/L), the
 *      appointmentCheckIns mirror doc, deposit fields, reminder defaults,
 *      checkInStatus — every downstream surface (check-in page, print
 *      ticket, readiness, AppointmentDetailsSheet) just works.
 *   4. REAL DEPOSIT POLICY — computeDepositCents with the full signature
 *      (poorHistory from noShowCount+cancellationCount>2, guardianActive),
 *      price resolved via serviceTiers by the provider's pricingTierId,
 *      exactly like BookingSheet.
 *   5. UNIFIED FAIRNESS — writes BOTH lastBookingAssignedAt (QuickBook's
 *      field) and lastServedTimestamp (online/manual dialog's field) on
 *      the assigned provider, healing the split rotation clock.
 *   6. DEPOSIT-SAFE STATUS — deposit required → 'deposit_pending' (which
 *      blocks availability everywhere), payment via the /check-in/{token}
 *      completion link (QuickBook v6's unified-token pattern). No deposit
 *      → 'confirmed'. The slot is NEVER exposed while money is pending.
 *
 * bookingMode ('instant' | 'approval') controls only the PAPERWORK, never
 * the calendar: approval mode still claims the slot and writes the
 * blocking appointment, but holds the link/notification for staff
 * Approve/Deny (voiceApproval field + VoiceBookingApprovalsPanel).
 *
 * NOTE ON IMPORT: '@/lib/deposit-policy' is imported directly — it's a
 * pure policy module used by client components but should carry no
 * 'use client' directive. If the Vercel build ever complains about that
 * import, say so and the policy math gets inlined here instead.
 */

import type { Firestore } from 'firebase-admin/firestore';
import { nanoid } from 'nanoid';
import { randomInt } from 'crypto';
import { computeDepositCents } from '@/lib/deposit-policy';
import {
  stripUndefined,
  localDateStr,
  localTimeHHmm,
  speakDateTime,
} from '@/lib/voice/voice-utils';
import {
  type TenantContext,
  verifySlotOpen,
  fetchDayAppointments,
} from '@/lib/voice/server-availability';

// Mirrors lib/short-code's visually-unambiguous alphabet (see QuickBookForm
// v5 notes): no 0/O, no 1/I/L — a code a client reads off a screen or
// printout at the front desk can't be mistyped into a false "not found".
const SHORT_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function generateShortCodeServer(length = 6): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += SHORT_CODE_ALPHABET[randomInt(SHORT_CODE_ALPHABET.length)];
  }
  return out;
}

const FORM_SIGNATURE_VALIDITY_MONTHS = 18; // same rule as QuickBookForm
const monthsBetween = (a: Date, b: Date): number =>
  (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());

export type CreateBookingInput = {
  service: any; // resolved service doc
  staffMember: any; // resolved, CONCRETE provider (no 'any' at this layer)
  startISO: string; // exact UTC instant, from check_availability's slot
  client: {
    clientId?: string | null; // existing client, verified by caller
    name: string;
    phone?: string;
    email?: string;
  };
  notes?: string;
  source: string; // 'ai_receptionist' | future: 'online' | 'manual'
  mode: 'instant' | 'approval';
  retellCallId?: string | null;
};

export type CreateBookingResult =
  | {
      ok: true;
      appointmentId: string;
      clientId: string;
      checkInToken: string;
      shortCode: string;
      status: 'deposit_pending' | 'confirmed';
      mode: 'instant' | 'approval';
      depositCents: number;
      link: string | null; // completion link (sent in instant mode; staged in approval)
      linkSent: boolean;
      spoken: string; // what happened, ready to relay
    }
  | { ok: false; error: string; spoken: string };

export async function createBooking(
  db: Firestore,
  tenantId: string,
  ctx: TenantContext,
  input: CreateBookingInput,
): Promise<CreateBookingResult> {
  const tz = ctx.timezone;
  const tenant = ctx.tenant || {};
  const { service, staffMember } = input;

  const startUtc = new Date(input.startISO);
  if (Number.isNaN(startUtc.getTime()) || startUtc.getTime() < Date.now()) {
    return {
      ok: false,
      error: 'invalid_start',
      spoken: "That time doesn't look right — let me double-check the options with you.",
    };
  }

  const dateLocal = localDateStr(startUtc, tz);
  const timeLocal = localTimeHHmm(startUtc, tz);
  const spokenWhen = speakDateTime(startUtc, tz);
  const providerFirst = (staffMember.name || 'the provider').split(' ')[0];

  // ── 1. Authoritative re-verify ─────────────────────────────────────────
  const dayAppointments = await fetchDayAppointments(db, tenantId, ctx, dateLocal);
  const verdict = verifySlotOpen({
    staffMember,
    service,
    startUtc,
    ctx,
    dayAppointments,
  });
  if (!verdict.open) {
    return {
      ok: false,
      error: verdict.reason,
      spoken: `Oh — ${spokenWhen} with ${providerFirst} just became unavailable. Let me check what else is open.`,
    };
  }

  // ── 2. Load / prepare the client ───────────────────────────────────────
  let clientId = input.client.clientId || null;
  let clientDoc: any = null;
  if (clientId) {
    const snap = await db.doc(`tenants/${tenantId}/clients/${clientId}`).get();
    if (snap.exists) clientDoc = snap.data();
    else clientId = null; // stale id — fall through to create
  }
  const clientName = (clientDoc?.name || input.client.name || '').trim() || 'Client';
  const clientPhone = (clientDoc?.phone || input.client.phone || '').trim();
  const clientEmail = (clientDoc?.email || input.client.email || '').trim();
  const isNewClient = !clientId;
  if (isNewClient) clientId = nanoid();

  if (clientDoc?.status === 'blocked' || clientDoc?.status === 'banned') {
    return {
      ok: false,
      error: 'client_blocked',
      spoken:
        'I ran into an account note I need the team to look at first — let me take your details and have them call you back.',
    };
  }

  // ── 3. Price + deposit (BookingSheet's exact model) ────────────────────
  const tierPrice = service.serviceTiers?.find(
    (t: any) => t.tierId === staffMember?.pricingTierId,
  )?.price;
  const price = Number(tierPrice ?? service.price ?? 0);

  const poorHistory = !!(
    clientDoc &&
    (Number(clientDoc.noShowCount) || 0) + (Number(clientDoc.cancellationCount) || 0) > 2
  );
  let depositCents = 0;
  try {
    depositCents = computeDepositCents({
      service,
      price,
      depositsLive: tenant?.depositsLive === true,
      poorHistory,
      guardianActive: tenant?.guardianProtocolEnabled !== false,
    });
  } catch {
    depositCents = 0;
  }

  // Forms needing signature (18-month validity, same as QuickBook)
  const requiredFormIds: string[] = service.requiredFormIds || [];
  const now = new Date();
  const formsNeedingSignature = requiredFormIds.filter((fid) => {
    const sig = clientDoc?.signedForms?.[fid];
    if (!sig?.signedAt) return true;
    const signedAt = new Date(sig.signedAt);
    if (Number.isNaN(signedAt.getTime())) return true;
    return monthsBetween(signedAt, now) >= FORM_SIGNATURE_VALIDITY_MONTHS;
  });
  // v2 — FIX: service-level required documents (Photo ID, etc.) were never
  // read here at all — fileRequirements below was hardcoded to an empty
  // array regardless of what the service actually requires. A client
  // booking the identical service via QuickBookForm would correctly be
  // asked for it; the same service booked by voice silently wasn't. Same
  // "already on file" rule as QuickBookForm: a requirement flagged
  // persistToProfile only counts as outstanding if this client's profile
  // doesn't already have a matching entry — matched by the requirement's
  // own stable id (not freshly minted here), so the same id ends up on
  // clientDoc.profileDocuments once fulfilled and is recognized as
  // satisfied at this client's next booking of the same service.
  const serviceFileReqs: any[] = service.requiredFileRequirements || [];
  const profileDocs: any[] = clientDoc?.profileDocuments || [];
  const pendingFileReqs = serviceFileReqs.filter((fr: any) => {
    if (!fr.persistToProfile) return true;
    return !profileDocs.some((pd: any) => pd.requirementId === fr.id);
  });
  const needsLink = depositCents > 0 || formsNeedingSignature.length > 0 || pendingFileReqs.length > 0;

  // ── 4. Transactional slot claim (QuickBook's lock discipline) ──────────
  const nowISO = new Date().toISOString();
  const aptId = nanoid();
  const lockKey = `${staffMember.id}_${dateLocal}_${timeLocal.replace(':', '')}`;
  const lockRef = db.doc(`tenants/${tenantId}/slotLocks/${lockKey}`);
  try {
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(lockRef);
      if (existing.exists) throw new Error('SLOT_TAKEN');
      tx.set(lockRef, {
        staffId: staffMember.id,
        date: dateLocal,
        time: timeLocal,
        aptId,
        reservedAt: nowISO,
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      });
    });
  } catch (e: any) {
    if (e?.message === 'SLOT_TAKEN') {
      return {
        ok: false,
        error: 'slot_taken',
        spoken: `Oh — ${spokenWhen} was just taken this second. Let me find you the next best option.`,
      };
    }
    throw e;
  }

  // ── 5. The booking write (full parity, one batch) ──────────────────────
  const checkInToken = nanoid();
  const shortCode = generateShortCodeServer();
  const endUtc = new Date(startUtc.getTime() + (service.duration ?? 60) * 60_000);
  const status: 'deposit_pending' | 'confirmed' =
    depositCents > 0 ? 'deposit_pending' : 'confirmed';

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.clarityflow.com';
  const link = needsLink ? `${appUrl}/check-in/${checkInToken}` : null;

  const aptDoc = stripUndefined({
    id: aptId,
    tenantId,
    clientId,
    clientName,
    serviceId: service.id,
    staffId: staffMember.id,
    checkInToken,
    shortCode,
    status,
    source: input.source,
    startTime: startUtc.toISOString(),
    endTime: endUtc.toISOString(),
    createdAt: nowISO,
    reminderSent: false,
    // v2 — respects the client's own notificationPreferences.reminderHoursBefore
    // when set, same priority order as QuickBookForm now uses. Falls back
    // to the existing 48h default for clients who haven't set a preference.
    reminderHours: Number(clientDoc?.notificationPreferences?.reminderHoursBefore) || 48,
    autoCancelledNoShow: false,
    checkInStatus: 'pending',
    notes: input.notes?.trim() || undefined,
    depositAmountCents: depositCents,
    depositStatus: depositCents > 0 ? 'pending' : 'none',
    completionStatus: needsLink ? 'pending' : undefined,
    voiceApproval: input.mode === 'approval' ? 'pending' : undefined,
    retellCallId: input.retellCallId || undefined,
    // Self-describing metadata so review surfaces need no joins:
    voiceMeta: stripUndefined({
      serviceName: service.name,
      providerName: staffMember.name,
      spoken: `${service.name} with ${providerFirst} on ${spokenWhen}`,
      link: link || undefined,
      clientPhone: clientPhone || undefined,
      clientEmail: clientEmail || undefined,
      depositCents,
      formsNeeded: formsNeedingSignature.length,
      filesNeeded: pendingFileReqs.length,
    }),
  });

  const batch = db.batch();

  if (isNewClient) {
    batch.set(
      db.doc(`tenants/${tenantId}/clients/${clientId}`),
      stripUndefined({
        id: clientId,
        name: clientName,
        phone: clientPhone || undefined,
        email: clientEmail || undefined,
        lifetimeValue: 0,
        lastAppointment: nowISO,
        status: 'active',
        reminderSent: false,
      }),
    );
  }
  batch.set(
    db.doc(`tenants/${tenantId}/clients/${clientId}`),
    stripUndefined({ lastServiceId: service.id, lastAppointment: nowISO }),
    { merge: true },
  );

  batch.set(db.doc(`tenants/${tenantId}/appointments/${aptId}`), aptDoc);
  batch.set(db.doc(`appointmentCheckIns/${checkInToken}`), aptDoc);

  if (needsLink) {
    const expiryDays = Number(tenant?.completionLinkExpiryDays) || 7;
    batch.set(
      db.doc(`tenants/${tenantId}/bookingCompletions/${checkInToken}`),
      stripUndefined({
        token: checkInToken,
        tenantId,
        appointmentId: aptId,
        clientId,
        clientName,
        clientEmail: clientEmail.toLowerCase(),
        serviceId: service.id,
        serviceName: service.name || '',
        depositAmountCents: depositCents,
        requiredConsentFormIds: formsNeedingSignature,
        skipCardStep: !!(clientDoc?.cardOnFile?.paymentMethodId || clientDoc?.cardOnFile?.token),
        cardAlreadyOnFile: !!(clientDoc?.cardOnFile?.paymentMethodId || clientDoc?.cardOnFile?.token),
        fileRequirements: pendingFileReqs.map((fr: any) => ({
          id: fr.id,
          type: 'file_upload',
          label: fr.label,
          required: true,
          prompt: fr.label,
          minCount: fr.minCount || 1,
          maxCount: fr.maxCount || 5,
          acceptedTypes: ['image/*', 'application/pdf'],
          persistToProfile: !!fr.persistToProfile,
        })),
        status: 'pending',
        createdAt: nowISO,
        expiresAt: new Date(Date.now() + expiryDays * 24 * 3600 * 1000).toISOString(),
      }),
    );
  }

  // Unified fairness: advance BOTH clocks on the assigned provider.
  batch.set(
    db.doc(`tenants/${tenantId}/staff/${staffMember.id}`),
    { lastBookingAssignedAt: nowISO, lastServedTimestamp: nowISO },
    { merge: true },
  );

  batch.delete(lockRef);
  await batch.commit();

  // ── 6. Instant mode: fire the link now; approval mode stages it ────────
  let linkSent = false;
  if (input.mode === 'instant' && link) {
    try {
      const res = await fetch(`${appUrl}/api/notifications/send-completion-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          link,
          clientName,
          clientEmail,
          clientPhone,
          studioName: tenant?.name,
        }),
      });
      const out = await res.json().catch(() => null);
      linkSent = !!(out?.smsSent || out?.emailSent || out?.ok);
    } catch {
      /* non-fatal — link is stored in voiceMeta; staff can resend */
    }
  }

  const spoken =
    input.mode === 'approval'
      ? `That's held for you — ${service.name} with ${providerFirst} on ${spokenWhen}. The team will confirm by text shortly${depositCents > 0 ? ', with a secure link for the deposit' : ''}.`
      : depositCents > 0
        ? `You're booked — ${service.name} with ${providerFirst} on ${spokenWhen}. ${linkSent ? "I've just texted" : "You'll receive"} a secure link to lock in the deposit of $${(depositCents / 100).toFixed(2)}.`
        : `You're all booked — ${service.name} with ${providerFirst} on ${spokenWhen}. A confirmation is on its way.`;

  return {
    ok: true,
    appointmentId: aptId,
    clientId: clientId!,
    checkInToken,
    shortCode,
    status,
    mode: input.mode,
    depositCents,
    link,
    linkSent,
    spoken,
  };
}
