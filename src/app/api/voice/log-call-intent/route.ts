/**
 * POST /api/voice/log-call-intent — v1
 *
 * The non-booking half of the AI receptionist. Booking intents flow to
 * callBackDrafts (create-callback-draft); everything else lands here, in
 * tenants/{tenantId}/voiceInbox, rendered by <VoiceInboxPanel />.
 *
 * Intents and what this route is allowed to DO for each:
 *
 *   cancel      — LOG ONLY. Never executes: the real cancellation path owns
 *                 fee logic, dual-write coverage, and refund machinery
 *                 (AppointmentDetailsSheet). Verifies the appointmentId
 *                 exists and belongs to the matched client before logging.
 *   reschedule  — LOG ONLY, but structured: old appointmentId + the new
 *                 slot verbally agreed on (requestedSlotISO), both
 *                 pre-formatted for display, so staff executes in one move.
 *   late        — THE ONE DIRECT WRITE. Zero-risk, time-critical: merges
 *                 lateNotice { minutes, reportedAt, source } onto the
 *                 appointment doc immediately (its value evaporates in a
 *                 queue), and still logs an inbox item (autoApplied: true)
 *                 so there's a visible record for the front desk.
 *   event_quote — LOG ONLY, ROUTED TWICE: the inbox row (with the call
 *                 recording) is the notification, AND a quoteRequests doc
 *                 is written in the exact shape the public inquiry form
 *                 uses — so voice leads land in the Quotes → Inquiries tab
 *                 alongside web leads, entering the same quote lifecycle
 *                 (viewed flags, priority, analytics). One pipeline, two
 *                 front doors.
 *   consultation — LOG ONLY, SHARED THREE WAYS: the inbox row carries the
 *                 full Q&A; a lastVoiceConsultation summary is merged onto
 *                 the CLIENT doc (so it travels to every future visit);
 *                 and when an appointmentId is provided (scheduled paid
 *                 consults pass it), the consultation is attached to that
 *                 appointment's voiceMeta so the provider sees it in
 *                 context. Optional appointmentId accepted for this
 *                 intent (not required, unlike cancel/reschedule/late).
 *   complaint   — LOG ONLY, and NEVER a live transfer: the business
 *                 reviews the recording + this inbox item first, then
 *                 decides how to handle the call-back. Pins to the top of
 *                 the inbox.
 *   message     — catch-all: transfer requests, vendor calls, anything
 *                 the agent shouldn't improvise on.
 *
 * Admin SDK → bypasses Firestore rules for the WRITE. The panel's client-
 * side READ subscription needs a rules addition — see VoiceInboxPanel header.
 *
 * Request:
 * {
 *   "tenantId": "...",
 *   "intent": "cancel" | "reschedule" | "late" | "event_quote" | "message",
 *   "callerName": "Dana",
 *   "callerPhone": "+13365551234",
 *   "clientId": "abc123" | null,          // from lookup-client, if matched
 *   "appointmentId": "...",               // required: cancel/reschedule/late
 *   "requestedSlotISO": "2026-07-09T...", // reschedule: the agreed new time
 *   "minutesLate": 15,                    // late
 *   "eventInquiry": {                     // event_quote
 *     "eventDate": "2026-08-15", "headcount": 8, "occasion": "bachelorette",
 *     "servicesOfInterest": "gel manis + nail art", "budgetRange": "$400-600",
 *     "contactEmail": "dana@example.com"
 *   },
 *   "details": "free text",
 *   "callSummary": "platform transcript summary"
 * }
 *
 * Response: { logged: true, inboxId, spokenSummary } or
 *           { logged: false, error, spokenSummary }
 */

import { internalHeaders } from '@/lib/message-policy';
import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { hasUsableCard as hasUsableCardCheck } from '@/lib/payments/has-usable-card';
import {
  verifyVoiceSecret,
  parseVoiceToolRequest,
  stripUndefined,
  speakDateTime,
  localDateStr,
  localTimeHHmm,
} from '@/lib/voice/voice-utils';
import {
  loadTenantContext,
  verifySlotOpen,
  fetchDayAppointments,
} from '@/lib/voice/server-availability';
import { isPoorHistory } from '@/lib/deposit-policy';
import { publicVisitCopy } from '@/lib/public-visit-copy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// A fee charged to the saved card from a call (api/stripe/charge-card): paid (the charge itself is its one line in the
// books — nothing here writes a second), declined (Stripe said no), or no answer (it may have gone through: never
// treated as a decline — nothing is canceled or moved on it, and the team is asked to check before charging again).
async function chargeFee(body: Record<string, any>): Promise<{ ok: true; paymentIntentId: string } | { ok: false; unknown: boolean; parked: boolean }> {
  const url = `${process.env.NEXT_PUBLIC_APP_URL || 'https://app.clarityflow.com'}/api/stripe/charge-card`;
  try {
    // Nothing is canceled or moved on a lost answer, so a charge that went through anyway is flagged, not kept quietly.
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...internalHeaders(String(url)) }, body: JSON.stringify({ onLost: 'refund', ...body }) });
    const d: any = await res.json().catch(() => null);
    if (res.status < 500 && d?.ok && d.paymentIntentId) return { ok: true, paymentIntentId: String(d.paymentIntentId) };
    return { ok: false, unknown: res.status >= 500 || !d || d.unknown === true, parked: d?.parkedAsBalance === true };
  } catch { return { ok: false, unknown: true, parked: false }; }
}

const INTENTS = ['cancel', 'reschedule', 'late', 'event_quote', 'complaint', 'consultation', 'message'] as const;
type Intent = (typeof INTENTS)[number];
const APPOINTMENT_INTENTS: Intent[] = ['cancel', 'reschedule', 'late'];

export async function POST(req: NextRequest) {
  if (!verifyVoiceSecret(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let raw: any;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({
      logged: false,
      error: 'invalid_json',
      spokenSummary: "I wasn't able to save that — let me try once more.",
    });
  }

  const { args: body, retellCallId, callerNumber } = parseVoiceToolRequest(raw);

  const tenantId: string = body?.tenantId;
  const intent: Intent = body?.intent;
  const callerName: string = (body?.callerName || '').trim();
  const callerPhone: string = (body?.callerPhone || callerNumber || '').trim();

  if (!tenantId || !INTENTS.includes(intent)) {
    return NextResponse.json({
      logged: false,
      error: 'missing_params',
      spokenSummary: "I couldn't log that request properly.",
    });
  }

  try {
    const db = getAdminDb();
    const ctx = await loadTenantContext(db, tenantId);
    const tz = ctx.timezone;

    // ── Appointment verification for cancel / reschedule / late ────────────
    let appointment: any = null;
    let svc: any = null;
    let start: Date | null = null;
    let appointmentSpoken: string | undefined;
    let codeVerified: 'verified' | 'mismatch' | 'not_provided' = 'not_provided';
    let autoCancelled = false;
    let autoCancelledFeeCharged = false;
    let autoCancelledFeeAmount: number | undefined;
    let autoCancelledFeePending = false;
    // A fee charge the card processor never answered: shown on the team's inbox item, so they check before charging.
    let feeUnconfirmed = false;
    if (APPOINTMENT_INTENTS.includes(intent)) {
      const aptId: string = body?.appointmentId;
      if (!aptId) {
        return NextResponse.json({
          logged: false,
          error: 'missing_appointment',
          spokenSummary:
            'I need to confirm which appointment that is first — let me look it up.',
        });
      }
      const aptSnap = await db
        .doc(`tenants/${tenantId}/appointments/${aptId}`)
        .get();
      if (!aptSnap.exists) {
        return NextResponse.json({
          logged: false,
          error: 'appointment_not_found',
          spokenSummary:
            "I couldn't find that appointment. Let me double-check the details with you.",
        });
      }
      appointment = { id: aptSnap.id, ...(aptSnap.data() as any) };

      // Identity guard: if lookup-client matched a client, the appointment
      // must belong to them — never act on someone else's appointment.
      if (body.clientId && appointment.clientId !== body.clientId) {
        return NextResponse.json({
          logged: false,
          error: 'appointment_client_mismatch',
          spokenSummary:
            "That appointment doesn't seem to be under this number. I'll take a message and have the team sort it out.",
        });
      }
      if (appointment.status === 'cancelled') {
        return NextResponse.json({
          logged: false,
          error: 'already_cancelled',
          spokenSummary: 'It looks like that appointment was already cancelled.',
        });
      }

      // v11 — confirmation-code verification. The phone-based clientId
      // match above only runs when lookup-client actually found someone —
      // an unrecognized number (different phone, shared family line,
      // blocked caller ID) skips that check ENTIRELY, with nothing else
      // standing in for it. shortCode is real proof: it's the code given
      // to the client at booking (texted, printed, shown on the
      // confirmation screen) — unlike a phone number, someone reciting it
      // correctly actually demonstrates they have the original booking
      // confirmation in hand. Optional and non-blocking: an unverified
      // request still logs for staff review exactly as before, just
      // clearly flagged so whoever reviews it knows to look closer before
      // clicking the one-click action.
      const suppliedCode: string = (body?.confirmationCode || '').trim().toUpperCase();
      if (suppliedCode) {
        codeVerified = suppliedCode === String(appointment.shortCode || '').toUpperCase()
          ? 'verified'
          : 'mismatch';
      }
      if (codeVerified === 'mismatch') {
        return NextResponse.json({
          logged: false,
          error: 'confirmation_code_mismatch',
          spokenSummary:
            "That confirmation number doesn't quite match what I have on file — could you double-check it, or I can just take a message for the team instead.",
        });
      }

      svc = ctx.services.find((s: any) => s.id === appointment.serviceId);
      const staffMember = ctx.staff.find((s: any) => s.id === appointment.staffId);
      start =
        typeof appointment.startTime === 'string'
          ? new Date(appointment.startTime)
          : null;
      appointmentSpoken = `${svc?.name || 'appointment'}${
        staffMember?.name ? ` with ${staffMember.name.split(' ')[0]}` : ''
      }${start && !Number.isNaN(start.getTime()) ? ` on ${speakDateTime(start, tz)}` : ''}`;

      // v12 — auto-execute a cancellation, with no staff click, ONLY when
      // every one of these holds. This is deliberately narrower than "any
      // fee-free cancel" — it requires the caller to have PROVEN they're
      // the actual client (shortCode match), not just a phone-number
      // heuristic, which is what made this safe to build at all (see the
      // codeVerified work above).
      //
      // v14 — extended to fee-BEARING cancellations too, but only when the
      // tenant has explicitly opted in via
      // voiceAgent.autoChargeFeeBearingActions (default false — this is
      // the single biggest autonomy step in the whole voice system, so it
      // does not activate silently). When active, a verified caller with a
      // usable card on file gets the fee charged immediately, same
      // /api/stripe/charge-card + kind:'arrears_fee' pattern self-cancel
      // already uses. Critically: if the charge FAILS, this does NOT
      // cancel the appointment anyway — falling back to staff review is
      // the correct outcome, since auto-cancelling without collecting a
      // deserved fee is exactly the kind of revenue loss this whole
      // feature exists to prevent, not cause.
      if (intent === 'cancel' && codeVerified === 'verified' && appointment.clientId) {
        const clientSnapForGate = await db.doc(`tenants/${tenantId}/clients/${appointment.clientId}`).get();
        const clientDocForGate = clientSnapForGate.exists ? clientSnapForGate.data() as any : null;
        const tenant = ctx.tenant || {};
        const hoursUntilStart = start && !Number.isNaN(start.getTime())
          ? (start.getTime() - Date.now()) / 3_600_000
          : 0;
        const cancellationWindowHours = Number(svc?.cancellationWindowHours) || Number(tenant.cancellationWindowHours) || 24;
        const isFeeFree = hoursUntilStart >= cancellationWindowHours;
        const poorHistory = isPoorHistory(clientDocForGate, tenant);
        const hasOutstandingBalance = (Number(clientDocForGate?.outstandingBalance) || 0) > 0;
        const safeToConsider = !!clientDocForGate && !poorHistory && !hasOutstandingBalance;

        // v21 — consolidated into the shared has-usable-card helper.
        const hasUsableCard = hasUsableCardCheck(clientDocForGate);

        let feeCharged = false;
        let feeAmount = 0;
        let stripePaymentIntentId: string | undefined;
        let shouldExecute = false;
        // v15 — NEW: cancel now with the fee left unresolved, rather than
        // falling all the way to staff review. Identity is already
        // verified — the cancellation itself isn't the risky part, and
        // holding the slot hostage to fee collection doesn't serve
        // anyone. The fee gets parked as owed (same outstandingBalance/
        // unpaidFees shape onCancellationEvent already uses for this
        // exact scenario) AND the client gets a self-service way to pay
        // it — the existing check-in link, re-sent, now showing a
        // payment prompt for this specific fee. Distinct from
        // shouldExecute (fee fully resolved) so the write below can
        // record which path actually happened.
        let shouldExecuteWithPendingFee = false;
        // The declined fee is on their balance already (the card route parked it): it isn't added again below.
        let feeParkedByCharge = false;

        if (safeToConsider && isFeeFree) {
          shouldExecute = true;
        } else if (safeToConsider && !isFeeFree && tenant.voiceAgent?.autoChargeFeeBearingActions === true) {
          feeAmount = Number(tenant.cancellationFee) || Number(svc?.price) || 0;
          if (feeAmount > 0 && hasUsableCard) {
            // Declined: the card route puts the fee on their balance itself, once, under the name every cancellation
            // path uses for this visit's fee (cancel-<visit>), so it's never added twice. No answer: nothing is
            // canceled; the team gets the request (and is told to check the payment first).
            const charged = await chargeFee({
              tenantId,
              clientId: appointment.clientId,
              amountCents: Math.round(feeAmount * 100),
              description: `Cancellation fee — ${svc?.name || 'Service'}`,
              category: 'Cancellation Fee',
              appointmentId: appointment.id,
              // Also what their owed fee says when the card is declined (what they see on their balance).
              reason: 'Late cancellation by phone',
              mode: 'auto',
              kind: 'arrears_fee',
              feeId: `cancel-${appointment.id}`,
            });
            if (charged.ok) {
              feeCharged = true;
              stripePaymentIntentId = charged.paymentIntentId;
              shouldExecute = true;
            } else if (charged.unknown) {
              feeUnconfirmed = true;
            } else {
              shouldExecuteWithPendingFee = true;
              feeParkedByCharge = charged.parked;
            }
          } else if (feeAmount > 0 && !hasUsableCard) {
            shouldExecuteWithPendingFee = true;
          } else {
            // No actual fee configured despite being "within the window" —
            // nothing to charge, so treat like the fee-free path.
            shouldExecute = true;
          }
        }

        if (shouldExecute || shouldExecuteWithPendingFee) {
          const cancelNowISO = new Date().toISOString();
          const cancelPatch: any = {
            status: 'cancelled',
            cancelledAt: cancelNowISO,
            cancellationReason: 'client_requested_via_voice',
            cancellationFeeCharged: feeCharged,
            cancellationAudit: {
              actorType: 'client',
              actorId: appointment.clientId || 'unknown_client',
              reason: feeCharged
                ? 'client_requested_via_voice_verified_fee_charged'
                : shouldExecuteWithPendingFee
                  ? 'client_requested_via_voice_verified_fee_pending_link_sent'
                  : 'client_requested_via_voice_verified',
              feeCharged,
              feeAmount: (feeCharged || shouldExecuteWithPendingFee) ? feeAmount : undefined,
              feePending: shouldExecuteWithPendingFee || undefined,
              stripePaymentIntentId,
              timestamp: cancelNowISO,
            },
            updatedAt: cancelNowISO,
          };
          // v15 — the "fully audible" activity record: this shows up on
          // the appointment timeline (AppointmentDetailsSheet already
          // reads appointment fields directly) so staff can see, without
          // digging, exactly what was tried and what happened — charge
          // attempted, declined/no card, fee parked, link sent.
          if (shouldExecuteWithPendingFee) {
            cancelPatch.feeLinkSentAt = cancelNowISO;
          }

          // Without empty fields (the database refuses them, and a fee charged a moment ago must never be left behind
          // by a cancellation that didn't save).
          const cancelBatch = db.batch();
          cancelBatch.set(db.doc(`tenants/${tenantId}/appointments/${appointment.id}`), stripUndefined(cancelPatch), { merge: true });
          if (appointment.checkInToken) {
            cancelBatch.set(db.doc(`appointmentCheckIns/${appointment.checkInToken}`), stripUndefined(publicVisitCopy(cancelPatch)), { merge: true });
            // v15 — when the fee is pending (not charged), the
            // bookingCompletions doc is NOT voided the way a normal
            // cancellation would be — it gets repurposed to carry the
            // owed fee, so the client's existing check-in link (same
            // token, nothing new to send them) can show a payment prompt
            // for it. See checkin-page.tsx's CancelledView for the
            // client-facing side of this.
            if (shouldExecuteWithPendingFee) {
              cancelBatch.set(
                db.doc(`tenants/${tenantId}/bookingCompletions/${appointment.checkInToken}`),
                stripUndefined({
                  status: 'fee_owed',
                  // v15 — FIX: reuses depositAmountCents (the exact field
                  // /api/stripe/completion already reads to build an
                  // Embedded Checkout session) rather than a new field
                  // name. CancelledView can call that same existing route
                  // unchanged — no new payment endpoint needed, no risk of
                  // a parallel, slightly-different implementation of the
                  // same "collect a specific dollar amount" job.
                  depositAmountCents: Math.round(feeAmount * 100),
                  clientId: appointment.clientId,
                  clientName: clientDocForGate?.name || appointment.clientName,
                  clientEmail: clientDocForGate?.email,
                  serviceName: `${svc?.name || 'Service'} — Late Cancellation Fee`,
                }),
                { merge: true },
              );
            } else {
              cancelBatch.set(
                db.doc(`tenants/${tenantId}/bookingCompletions/${appointment.checkInToken}`),
                { status: 'void' },
                { merge: true },
              );
            }
          }
          // A charged fee is in the books already: the card charge wrote its one line (Cancellation Fee).
          await cancelBatch.commit();
          // Owed (no card on file): on their balance once, under this visit's fee name — the same name the card route
          // and every other cancellation path use, so nothing adds it twice. Declined: the card route parked it already.
          if (shouldExecuteWithPendingFee && appointment.clientId && !feeParkedByCharge) {
            const cRef = db.doc(`tenants/${tenantId}/clients/${appointment.clientId}`); const feeId = `cancel-${appointment.id}`;
            await db.runTransaction(async (tx) => {
              const cur: any = (await tx.get(cRef)).data();
              if (!cur || (Array.isArray(cur.unpaidFees) ? cur.unpaidFees : []).some((f: any) => f?.feeId === feeId)) return;
              tx.update(cRef, {
                outstandingBalance: FieldValue.increment(feeAmount),
                unpaidFees: FieldValue.arrayUnion({ feeId, appointmentId: appointment.id, appointmentDate: cancelNowISO, feeAmount, reason: 'Late Cancellation Fee (voice, self-pay link sent)' }),
              });
            });
          }
          autoCancelled = true;
          autoCancelledFeeCharged = feeCharged;
          autoCancelledFeeAmount = (feeCharged || shouldExecuteWithPendingFee) ? feeAmount : undefined;
          autoCancelledFeePending = shouldExecuteWithPendingFee;

          // v15 — resend the SAME check-in link (same token — nothing new
          // to give the client) so it's fresh in their texts/email with
          // framing specifically about the fee, rather than expecting
          // them to dig up the original booking confirmation from
          // however long ago.
          if (shouldExecuteWithPendingFee && appointment.checkInToken) {
            try {
              const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.clarityflow.com';
              await fetch(`${appUrl}/api/notifications/send-completion-link`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-cf-internal': process.env.CRON_SECRET || '' },
                body: JSON.stringify({
                  tenantId, appointmentId: appointment.id, reason: 'fee',
                  link: `${appUrl}/check-in/${appointment.checkInToken}`,
                  clientName: clientDocForGate?.name || appointment.clientName,
                  clientEmail: clientDocForGate?.email,
                  clientPhone: clientDocForGate?.phone,
                  studioName: tenant.name,
                }),
              });
            } catch {
              /* non-fatal — the fee is still recorded as owed either way; staff can resend manually */
            }
          }
        }
      }
    }

    // ── Reschedule: format the agreed-upon new slot, and auto-execute when safe ──
    let requestedSlotSpoken: string | undefined;
    let autoRescheduled = false;
    let autoRescheduledFeeCharged = false;
    let autoRescheduledFeeAmount: number | undefined;
    if (intent === 'reschedule' && body.requestedSlotISO) {
      const t = new Date(body.requestedSlotISO);
      if (!Number.isNaN(t.getTime())) requestedSlotSpoken = speakDateTime(t, tz);

      // v14 — auto-execute a reschedule, mirroring execute-reschedule.ts's
      // actual move logic (that route requires staff auth and can't be
      // called directly from here — same reasoning create-booking has its
      // own inline slot-lock rather than sharing QuickBookForm's client-
      // side code). Fee-free moves auto-execute under the same verified-
      // caller bar as fee-free cancellation, unconditionally. Fee-bearing
      // moves additionally require the SAME tenant opt-in
      // (voiceAgent.autoChargeFeeBearingActions) as fee-bearing
      // cancellation — one setting governs both, since it's the same
      // underlying trust decision either way.
      if (codeVerified === 'verified' && appointment.clientId && !Number.isNaN(t.getTime()) && t.getTime() > Date.now()) {
        const clientSnapForGate = await db.doc(`tenants/${tenantId}/clients/${appointment.clientId}`).get();
        const clientDocForGate = clientSnapForGate.exists ? clientSnapForGate.data() as any : null;
        const tenant = ctx.tenant || {};
        const hoursUntilOriginal = start && !Number.isNaN(start.getTime())
          ? (start.getTime() - Date.now()) / 3_600_000
          : 0;
        const rescheduleFeeAmount = Number(tenant.rescheduleFee) || 0;
        const rescheduleWindowHours = Number(tenant.rescheduleFeeWindowHours) || 0;
        const isFeeFree = !(rescheduleFeeAmount > 0 && rescheduleWindowHours > 0 && hoursUntilOriginal < rescheduleWindowHours);
        const poorHistory = isPoorHistory(clientDocForGate, tenant);
        const hasOutstandingBalance = (Number(clientDocForGate?.outstandingBalance) || 0) > 0;
        const safeToConsider = !!clientDocForGate && !poorHistory && !hasOutstandingBalance;

        // v21 — consolidated into the shared has-usable-card helper.
        const hasUsableCard = hasUsableCardCheck(clientDocForGate);

        let feeCharged = false;
        // The fee is charged only once the new time is held for this move (below), and only a move that happens is
        // charged: a fee for a move that didn't happen is never taken, nor put on their balance.
        const withFee = safeToConsider && !isFeeFree && tenant.voiceAgent?.autoChargeFeeBearingActions === true && hasUsableCard;
        const shouldExecute = (safeToConsider && isFeeFree) || withFee;

        if (shouldExecute) {
          // Re-verify the target slot server-side, excluding the appointment
          // being moved — same guarantee as execute-reschedule.ts.
          const dateLocal = localDateStr(t, tz);
          const timeLocal = localTimeHHmm(t, tz);
          const staffMember = ctx.staff.find((s: any) => s.id === (body.requestedProviderId || appointment.staffId));
          const dayApts = staffMember
            ? (await fetchDayAppointments(db, tenantId, ctx, dateLocal)).filter((a: any) => a.id !== appointment.id)
            : [];
          const verdict = staffMember
            ? verifySlotOpen({ staffMember, service: svc, startUtc: t, ctx, dayAppointments: dayApts })
            : { open: false, reason: 'provider_not_found' };

          if (verdict.open && staffMember) {
            const lockKey = `${staffMember.id}_${dateLocal}_${timeLocal.replace(':', '')}`;
            const lockRef = db.doc(`tenants/${tenantId}/slotLocks/${lockKey}`);
            let claimed = false;
            try {
              await db.runTransaction(async (tx) => {
                const existing = await tx.get(lockRef);
                if (existing.exists) throw new Error('SLOT_TAKEN');
                tx.set(lockRef, {
                  staffId: staffMember.id,
                  date: dateLocal,
                  time: timeLocal,
                  aptId: appointment.id,
                  reservedAt: new Date().toISOString(),
                  expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
                });
              });
              claimed = true;
            } catch {
              claimed = false;
            }

            // The time is held: now the fee. Charged under a key named after this move (the visit, the new time, the
            // amount and the card), so the voice platform asking again is the same charge. Declined or no answer: the
            // time is let go and the team gets the request (told to check the payment first when there was no answer).
            if (claimed && withFee) {
              const charged = await chargeFee({
                tenantId,
                clientId: appointment.clientId,
                amountCents: Math.round(rescheduleFeeAmount * 100),
                description: `Reschedule fee — ${svc?.name || 'Service'}`,
                category: 'Adjustment Fee',
                taxBucket: 'adjustment',
                appointmentId: appointment.id,
                reason: 'Voice-verified reschedule, tenant opted into auto-charge',
                mode: 'auto',
                kind: 'deposit',
                idempotencyKey: `resched_${String(appointment.id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60)}_${t.getTime()}_${Math.round(rescheduleFeeAmount * 100)}_${String(clientDocForGate?.cardOnFile?.paymentMethodId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40)}`,
              });
              if (charged.ok) feeCharged = true;
              else {
                if (charged.unknown) feeUnconfirmed = true;
                await lockRef.delete().catch(() => {});
                claimed = false;
              }
            }

            if (claimed) {
              const oldStart = new Date(appointment.startTime);
              const oldEnd = new Date(appointment.endTime);
              const durationMs =
                !Number.isNaN(oldStart.getTime()) && !Number.isNaN(oldEnd.getTime()) && oldEnd > oldStart
                  ? oldEnd.getTime() - oldStart.getTime()
                  : (svc?.duration ?? 60) * 60_000;
              const newEnd = new Date(t.getTime() + durationMs);
              const rescheduleNowISO = new Date().toISOString();
              const providerChanged = staffMember.id !== appointment.staffId;

              const historyEntry = stripUndefined({
                from: appointment.startTime,
                to: t.toISOString(),
                fromStaffId: appointment.staffId,
                toStaffId: staffMember.id,
                at: rescheduleNowISO,
                by: appointment.clientId,
                source: 'voice_verified_auto',
                feeCharged,
                feeAmount: feeCharged ? rescheduleFeeAmount : undefined,
              });
              const movePatch = {
                startTime: t.toISOString(),
                endTime: newEnd.toISOString(),
                staffId: staffMember.id,
                reminderSent: false,
                updatedAt: rescheduleNowISO,
              };

              const moveBatch = db.batch();
              moveBatch.set(
                db.doc(`tenants/${tenantId}/appointments/${appointment.id}`),
                { ...movePatch, rescheduleHistory: FieldValue.arrayUnion(historyEntry) },
                { merge: true },
              );
              if (appointment.checkInToken) {
                moveBatch.set(db.doc(`appointmentCheckIns/${appointment.checkInToken}`), movePatch, { merge: true });
              }
              if (providerChanged) {
                moveBatch.set(
                  db.doc(`tenants/${tenantId}/staff/${staffMember.id}`),
                  { lastBookingAssignedAt: rescheduleNowISO, lastServedTimestamp: rescheduleNowISO },
                  { merge: true },
                );
              }
              // A charged fee is in the books already: the card charge wrote its one line (Adjustment Fee).
              moveBatch.delete(lockRef);
              await moveBatch.commit();
              autoRescheduled = true;
              autoRescheduledFeeCharged = feeCharged;
              autoRescheduledFeeAmount = feeCharged ? rescheduleFeeAmount : undefined;
            }
          }
          // If the slot wasn't open or couldn't be claimed, this silently
          // falls through to the standard staff-reviewed inbox item below —
          // same as execute-reschedule.ts returning slot_taken and the
          // panel falling back to manual handling.
        }
      }
    }

    // ── Late: the one direct write ──────────────────────────────────────────
    let autoApplied = false;
    let minutesLate: number | undefined;
    if (intent === 'late') {
      minutesLate = Math.max(1, Math.min(240, Math.round(Number(body.minutesLate) || 15)));
      await db.doc(`tenants/${tenantId}/appointments/${appointment.id}`).set(
        {
          lateNotice: {
            minutes: minutesLate,
            reportedAt: new Date().toISOString(),
            source: 'ai_receptionist',
          },
        },
        { merge: true },
      );
      autoApplied = true;
    }

    // ── Consultation payload ────────────────────────────────────────────────
    const consultation =
      intent === 'consultation' && body.consultation
        ? stripUndefined({
            summary: (body.consultation.summary || '').trim() || undefined,
            answers: Array.isArray(body.consultation.answers)
              ? body.consultation.answers
                  .filter((a: any) => a && (a.question || a.answer))
                  .map((a: any) => ({
                    question: String(a.question || ''),
                    answer: String(a.answer || ''),
                  }))
              : undefined,
            recommendedServices:
              (body.consultation.recommendedServices || '').trim() || undefined,
            redFlags: (body.consultation.redFlags || '').trim() || undefined,
          })
        : undefined;

    // ── Event inquiry payload ────────────────────────────────────────────────
    const eventInquiry =
      intent === 'event_quote' && body.eventInquiry
        ? stripUndefined({
            eventDate: body.eventInquiry.eventDate || undefined,
            headcount: Number(body.eventInquiry.headcount) || undefined,
            occasion: (body.eventInquiry.occasion || '').trim() || undefined,
            servicesOfInterest:
              (body.eventInquiry.servicesOfInterest || '').trim() || undefined,
            budgetRange: (body.eventInquiry.budgetRange || '').trim() || undefined,
            contactEmail: (body.eventInquiry.contactEmail || '').trim() || undefined,
          })
        : undefined;

    // ── Routing beyond the inbox ────────────────────────────────────────────
    const now = new Date().toISOString();

    // event_quote → quoteRequests (the Inquiries tab's collection), matching
    // the public form's field shape so the existing UI needs zero changes.
    if (intent === 'event_quote') {
      const e = body.eventInquiry || {};
      const nameParts = (callerName || 'Caller').split(' ');
      const firstName = nameParts[0] || 'Caller';
      const lastName = nameParts.slice(1).join(' ');
      const guestCount = Number(e.headcount) || 0;
      const qrId = nanoid();
      await db.doc(`tenants/${tenantId}/quoteRequests/${qrId}`).set(
        stripUndefined({
          id: qrId,
          tenantId,
          status: 'new',
          firstName,
          lastName,
          fullName: callerName || 'Caller',
          email: (e.contactEmail || '').trim().toLowerCase() || null,
          phone: callerPhone || null,
          preferredContact: callerPhone ? 'phone' : 'email',
          eventType: 'other',
          eventName: `${firstName}'s ${(e.occasion || 'Event').trim()}`,
          eventDate: e.eventDate || null,
          guestCount,
          partySize: guestCount,
          interestedServiceIds: [],
          interestedServices: [],
          customServiceNote: (e.servicesOfInterest || '').trim() || null,
          budgetRange: (e.budgetRange || '').trim() || null,
          specialRequests: (body.details || '').trim() || null,
          submittedAt: now,
          source: 'ai_receptionist',
          viewed: false,
          priority: guestCount >= 20 ? 'high' : 'normal',
          retellCallId: retellCallId || null,
        }),
      );
    }

    // consultation → client record (+ appointment when provided)
    if (intent === 'consultation' && consultation) {
      if (body.clientId) {
        await db
          .doc(`tenants/${tenantId}/clients/${body.clientId}`)
          .set(
            {
              lastVoiceConsultation: stripUndefined({
                summary: consultation.summary,
                recommendedServices: consultation.recommendedServices,
                redFlags: consultation.redFlags,
                answersCount: consultation.answers?.length || 0,
                at: now,
              }),
            },
            { merge: true },
          )
          .catch(() => {});
      }
      if (body.appointmentId) {
        await db
          .doc(`tenants/${tenantId}/appointments/${body.appointmentId}`)
          .set({ voiceMeta: { consultation } }, { merge: true })
          .catch(() => {});
      }
    }

    const inboxId = nanoid();

    await db.doc(`tenants/${tenantId}/voiceInbox/${inboxId}`).set(
      stripUndefined({
        id: inboxId,
        tenantId,
        createdAt: now,
        intent,
        callerName: callerName || 'Unknown caller',
        callerPhone,
        clientId: body.clientId || null,
        appointmentId: appointment?.id,
        appointmentSpoken,
        // v11 — surfaced on the inbox row so staff reviewing a cancel/
        // reschedule can see at a glance whether the caller actually
        // proved ownership (shortCode matched) versus this only being
        // backed by a phone-number match or nothing at all.
        codeVerified: APPOINTMENT_INTENTS.includes(intent) ? codeVerified : undefined,
        requestedSlotISO: body.requestedSlotISO || undefined,
        requestedProviderId: body.requestedProviderId || undefined,
        requestedSlotSpoken,
        minutesLate,
        autoApplied: (autoApplied || autoCancelled || autoRescheduled) || undefined,
        eventInquiry,
        consultation,
        details: (body.details || '').trim() || undefined,
        callSummary: (body.callSummary || '').trim() || undefined,
        // A fee charge the card processor never answered: it may have gone through, so the team checks their payments
        // before charging it again (or cancelling / moving the visit with a fee).
        paymentUnconfirmed: feeUnconfirmed || undefined,
        paymentNote: feeUnconfirmed ? 'A fee charge to their card on file was tried and not confirmed. Check their payments before charging again.' : undefined,
        status: 'open',
        source: 'ai_receptionist',
        retellCallId: retellCallId || undefined, // links item → recording
      }),
    );

    const confirmations: Record<Intent, string> = {
      cancel:
        autoCancelled && autoCancelledFeeCharged
          ? `You're all set — that appointment's cancelled. Since it's within the cancellation window, I charged the ${(autoCancelledFeeAmount || 0).toFixed(2)} dollar fee to your card on file.`
          : autoCancelled && autoCancelledFeePending
            ? `That appointment's cancelled. There's a ${(autoCancelledFeeAmount || 0).toFixed(2)} dollar cancellation fee since it's short notice — I've just texted you a secure link to take care of that whenever's convenient.`
            : autoCancelled
              ? "You're all set — that appointment's cancelled, no fee since you gave us plenty of notice."
              : codeVerified === 'verified'
                ? "You're confirmed on that appointment, so I've passed your cancellation straight through — the team will finalize it shortly."
                : "I've passed your cancellation request to the team — they'll confirm it shortly.",
      reschedule:
        autoRescheduled && autoRescheduledFeeCharged
          ? `You're all set — that's moved to ${requestedSlotSpoken}. Since it's a short-notice change, I charged the ${(autoRescheduledFeeAmount || 0).toFixed(2)} dollar reschedule fee to your card on file.`
          : autoRescheduled
            ? `You're all set — that's moved to ${requestedSlotSpoken}, no fee.`
            : requestedSlotSpoken
              ? `I've noted the move to ${requestedSlotSpoken} — the team will confirm it shortly.`
              : "I've passed your reschedule request to the team — they'll follow up with times.",
      late: `Got it — I've let them know you're running about ${minutesLate} minutes behind.`,
      event_quote:
        "I've got all the details down — someone will reach out with a quote.",
      complaint:
        "I'm sorry about that — I've written down everything you told me, and the owner will personally review it and call you back.",
      consultation:
        "I've saved all of that so your provider has the full picture before you come in.",
      message: "I've taken your message and the team will get back to you.",
    };

    return NextResponse.json({
      logged: true,
      inboxId,
      spokenSummary: confirmations[intent],
    });
  } catch (e) {
    console.error('[voice/log-call-intent]', e);
    return NextResponse.json({
      logged: false,
      error: 'internal',
      spokenSummary:
        "I'm having trouble saving that. Could you give me your number so the team can call you back?",
    });
  }
}
