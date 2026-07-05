/**
 * POST /api/voice/create-booking — v1
 *
 * The voice agent's tool for a slot the caller VERBALLY COMMITTED to.
 * Replaces create-callback-draft for committed bookings (drafts remain the
 * landing zone for calls that end WITHOUT an agreed slot — "let me check
 * with my husband"). The engine claims the slot in-call: if the slot
 * evaporated between check_availability and now, this returns slot_taken
 * WHILE THE CALLER IS STILL ON THE PHONE, so the agent recovers with
 * alternatives instead of anyone discovering a conflict tomorrow.
 *
 * Behavior by tenant setting voiceAgent.bookingMode:
 *   'approval' (default) — slot claimed, blocking appointment written,
 *     paperwork (deposit link / confirmation) held for staff Approve/Deny
 *     in the VoiceBookingApprovalsPanel. The calendar is protected either
 *     way; only the notification waits.
 *   'instant' — same write, plus the completion link fires within seconds
 *     of the call. The client's deposit IS the approval.
 *
 * Request (Retell envelope or flat):
 * {
 *   "tenantId": "...",
 *   "serviceId": "...",            // from check_availability's response
 *   "providerId": "...",           // from the chosen slot
 *   "startISO": "...",             // from the chosen slot — exact instant
 *   "clientId": "abc" | null,      // from lookup_client if matched
 *   "callerName": "Dana",
 *   "callerPhone": "+1336...",
 *   "callerEmail": "optional",
 *   "notes": "optional"
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyVoiceSecret, parseVoiceToolRequest } from '@/lib/voice/voice-utils';
import {
  loadTenantContext,
  resolveService,
  resolveProvider,
} from '@/lib/voice/server-availability';
import { createBooking } from '@/lib/booking/create-booking';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!verifyVoiceSecret(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let raw: any;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({
      booked: false,
      error: 'invalid_json',
      spokenSummary: "Something glitched on my end — give me one second to try that again.",
    });
  }

  const { args: body, retellCallId, callerNumber } = parseVoiceToolRequest(raw);

  const tenantId: string = body?.tenantId;
  const startISO: string = body?.startISO;
  const callerName: string = (body?.callerName || '').trim();
  const callerPhone: string = (body?.callerPhone || callerNumber || '').trim();

  if (!tenantId || !startISO || !body?.serviceId || !body?.providerId || (!callerName && !body?.clientId)) {
    return NextResponse.json({
      booked: false,
      error: 'missing_params',
      spokenSummary:
        'I need the service, the exact time we agreed on, and a name before I can lock that in.',
    });
  }

  try {
    const db = getAdminDb();
    const ctx = await loadTenantContext(db, tenantId);

    const service = resolveService(ctx, { serviceId: body.serviceId, serviceName: body.serviceId });
    if (!service) {
      return NextResponse.json({
        booked: false,
        error: 'service_not_found',
        spokenSummary: "I lost track of which service that was — could you remind me what you'd like done?",
      });
    }
    const staffMember = resolveProvider(ctx, { providerId: body.providerId });
    if (!staffMember) {
      return NextResponse.json({
        booked: false,
        error: 'provider_not_found',
        spokenSummary: 'Let me re-check who was available at that time.',
      });
    }

    const mode: 'instant' | 'approval' =
      ctx.tenant?.voiceAgent?.bookingMode === 'instant' ? 'instant' : 'approval';

    const result = await createBooking(db, tenantId, ctx, {
      service,
      staffMember,
      startISO,
      client: {
        clientId: body.clientId || null,
        name: callerName,
        phone: callerPhone,
        email: (body.callerEmail || '').trim(),
      },
      notes: body.notes,
      source: 'ai_receptionist',
      mode,
      retellCallId,
    });

    if (!result.ok) {
      return NextResponse.json({
        booked: false,
        error: result.error,
        spokenSummary: result.spoken,
      });
    }

    return NextResponse.json({
      booked: true,
      appointmentId: result.appointmentId,
      status: result.status,
      mode: result.mode,
      depositCents: result.depositCents,
      linkSent: result.linkSent,
      spokenSummary: result.spoken,
    });
  } catch (e) {
    console.error('[voice/create-booking]', e);
    return NextResponse.json({
      booked: false,
      error: 'internal',
      spokenSummary:
        "I couldn't lock that in just now. Let me save your details instead and the team will confirm the time with you shortly.",
    });
  }
}
