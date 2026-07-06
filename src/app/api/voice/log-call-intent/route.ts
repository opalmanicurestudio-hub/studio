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
 *   event_quote — LOG ONLY. The AI never quotes custom prices; it's an
 *                 intake form with a voice. Structured eventInquiry payload
 *                 feeds your studioEvents funnel.
 *   consultation — LOG ONLY: the structured intake from a voice
 *                 consultation (per-tenant question guide) — answers,
 *                 services discussed, and any red flags the caller
 *                 mentioned. Usually followed by a booking on the same
 *                 call.
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

import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { getAdminDb } from '@/lib/firebase-admin';
import {
  verifyVoiceSecret,
  parseVoiceToolRequest,
  stripUndefined,
  speakDateTime,
} from '@/lib/voice/voice-utils';
import { loadTenantContext } from '@/lib/voice/server-availability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
    let appointmentSpoken: string | undefined;
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

      const svc = ctx.services.find((s: any) => s.id === appointment.serviceId);
      const staffMember = ctx.staff.find((s: any) => s.id === appointment.staffId);
      const start =
        typeof appointment.startTime === 'string'
          ? new Date(appointment.startTime)
          : null;
      appointmentSpoken = `${svc?.name || 'appointment'}${
        staffMember?.name ? ` with ${staffMember.name.split(' ')[0]}` : ''
      }${start && !Number.isNaN(start.getTime()) ? ` on ${speakDateTime(start, tz)}` : ''}`;
    }

    // ── Reschedule: format the agreed-upon new slot ─────────────────────────
    let requestedSlotSpoken: string | undefined;
    if (intent === 'reschedule' && body.requestedSlotISO) {
      const t = new Date(body.requestedSlotISO);
      if (!Number.isNaN(t.getTime())) requestedSlotSpoken = speakDateTime(t, tz);
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

    const now = new Date().toISOString();
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
        requestedSlotISO: body.requestedSlotISO || undefined,
        requestedSlotSpoken,
        minutesLate,
        autoApplied: autoApplied || undefined,
        eventInquiry,
        consultation,
        details: (body.details || '').trim() || undefined,
        callSummary: (body.callSummary || '').trim() || undefined,
        status: 'open',
        source: 'ai_receptionist',
        retellCallId: retellCallId || undefined, // links item → recording
      }),
    );

    const confirmations: Record<Intent, string> = {
      cancel:
        "I've passed your cancellation request to the team — they'll confirm it shortly.",
      reschedule: requestedSlotSpoken
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
