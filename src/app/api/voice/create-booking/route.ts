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
import { hasUsableCard } from '@/lib/payments/has-usable-card';
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

  // v10 — the tenant-wide instant/approval switch (input.mode) stays a
  // single simple setting — that's deliberate, not a gap. But a specific
  // booking can still get downgraded to approval underneath it when a real
  // risk signal is present, the same way "On File" file requirements can
  // still be overridden by requiresEveryAppointment, or a client's saved
  // card gets treated as unusable once it's expired. Three independent
  // reasons force the downgrade, any one is enough:
  //   1. poorHistory — more than 2 combined no-shows/cancellations. A
  //      bigger deposit alone (which poorHistory already triggers via
  //      computeDepositCents) protects the MONEY on this one booking; it
  //      doesn't protect the CALENDAR from a client with a demonstrated
  //      pattern of not showing up.
  //   2. An outstanding balance from a previous visit — instantly
  //      confirming a new slot for someone who already owes money is how
  //      unpaid balances compound instead of getting resolved.
  //   3. The service itself is flagged voiceAlwaysRequireApproval — an
  //      owner's explicit call that this specific service always wants a
  //      human's eyes regardless of anything else.
  const hasOutstandingBalance = (Number(clientDoc?.outstandingBalance) || 0) > 0;
  const serviceForcesApproval = !!(service as any).voiceAlwaysRequireApproval;
  const effectiveMode: 'instant' | 'approval' =
    input.mode === 'instant' && !poorHistory && !hasOutstandingBalance && !serviceForcesApproval
      ? 'instant'
      : 'approval';

  // v21 — consolidated into the shared has-usable-card helper (was
  // duplicated inline across five files — see that file's header comment).
  const hasUsableCard_ = hasUsableCard(clientDoc);
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
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.clarityflow.com';

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

  // v10 — deposit auto-charge. Only attempted when the booking is
  // genuinely going instant — a booking that got downgraded to approval
  // above (poor history, outstanding balance, or a service flagged for
  // manual review) never gets an unsupervised card charge either; the
  // whole point of forcing a human look is that a charge shouldn't happen
  // without one. On decline, this falls through to exactly the same
  // completion-link path as "no card at all" — the client's booking still
  // goes through, they just secure the deposit via the link instead.
  let depositCharged = false;
  let depositChargeIntentId: string | undefined;
  if (effectiveMode === 'instant' && depositCents > 0 && hasUsableCard_ && clientId) {
    try {
      const chargeRes = await fetch(`${appUrl}/api/stripe/charge-card`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          clientId,
          amountCents: depositCents,
          description: `Deposit — ${service.name}`,
          category: 'Retainers',
          appointmentId: aptId,
          reason: 'Voice booking deposit — card on file',
          mode: 'auto',
          kind: 'deposit',
        }),
      });
      const chargeData = await chargeRes.json().catch(() => ({ ok: false }));
      if (chargeData.ok) {
        depositCharged = true;
        depositChargeIntentId = chargeData.paymentIntentId;
      }
    } catch {
      /* falls through to completion-link path below, same as a declined card */
    }
  }

  // v10 — needsLink now reflects the charge outcome: a successfully
  // charged deposit no longer forces a link on its own. Forms and pending
  // documents still can, same as always.
  const needsLink = (depositCents > 0 && !depositCharged) || formsNeedingSignature.length > 0 || pendingFileReqs.length > 0;

  // ── 5. The booking write (full parity, one batch) ──────────────────────
  const checkInToken = nanoid();
  const shortCode = generateShortCodeServer();
  const endUtc = new Date(startUtc.getTime() + (service.duration ?? 60) * 60_000);
  // v10 — a successfully charged deposit means the appointment is fully
  // confirmed immediately, not deposit_pending, even though depositCents > 0.
  const status: 'deposit_pending' | 'confirmed' =
    depositCents > 0 && !depositCharged ? 'deposit_pending' : 'confirmed';

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
    depositStatus: depositCents === 0 ? 'none' : depositCharged ? 'paid' : 'pending',
    depositPaymentIntentId: depositChargeIntentId,
    depositChargedViaVoice: depositCharged || undefined,
    completionStatus: needsLink ? 'pending' : undefined,
    voiceApproval: effectiveMode === 'approval' ? 'pending' : undefined,
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
      depositCharged,
      formsNeeded: formsNeedingSignature.length,
      filesNeeded: pendingFileReqs.length,
      // v10 — visible on the approvals panel so staff can see AT A
      // GLANCE why a specific booking got downgraded to approval even
      // though the tenant is set to instant — without this, "why didn't
      // this one auto-confirm" would require digging through the client
      // record by hand every time.
      downgradedFromInstant: input.mode === 'instant' && effectiveMode === 'approval'
        ? (poorHistory ? 'poor_history' : hasOutstandingBalance ? 'outstanding_balance' : 'service_requires_review')
        : undefined,
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
        depositAmountCents: depositCharged ? 0 : depositCents,
        requiredConsentFormIds: formsNeedingSignature,
        skipCardStep: depositCharged || !!(clientDoc?.cardOnFile?.paymentMethodId || clientDoc?.cardOnFile?.token),
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
  if (effectiveMode === 'instant' && link) {
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

  // v10 — new first branch: deposit successfully charged against the card
  // on file. Fully confirmed, nothing further needed from the client for
  // the deposit itself (though a link may still exist for forms/files —
  // spoken text stays quiet about that specific and lets the text/email
  // speak for itself, matching how forms-only bookings already behave).
  const spoken =
    effectiveMode === 'approval'
      ? `That's held for you — ${service.name} with ${providerFirst} on ${spokenWhen}. The team will confirm by text shortly${depositCents > 0 ? ', with a secure link for the deposit' : ''}.`
      : depositCharged
        ? `You're all set — ${service.name} with ${providerFirst} on ${spokenWhen}. I've charged your card on file $${(depositCents / 100).toFixed(2)} to secure it.`
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
    mode: effectiveMode,
    depositCents,
    depositCharged,
    link,
    linkSent,
    spoken,
  };
}
