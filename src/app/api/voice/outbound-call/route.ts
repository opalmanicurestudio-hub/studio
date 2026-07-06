/**
 * POST /api/voice/outbound-call — v1
 *
 * Staff-triggered: have the AI assistant CALL A CLIENT on the business's
 * behalf about a specific appointment — a cancellation notice or a
 * studio-initiated reschedule. The killer scenario: a provider calls out
 * sick, staff triggers this for each affected appointment, and the agent
 * apologizes, offers the same time with another provider or new times
 * (using check_availability LIVE on the call), and logs the outcome to the
 * voice inbox / call-back drafts like any inbound call would.
 *
 * AUTH IS DIFFERENT from the other voice routes: this is called from YOUR
 * app's staff UI, not from Retell — so the x-voice-secret can't be used
 * (it would have to live in browser code). Instead it verifies a Firebase
 * ID token (Authorization: Bearer <token>) and checks the caller is staff
 * of the tenant, mirroring your Firestore rules' isStaff(): tenant owner
 * (tenant.userId) or a doc at tenants/{tenantId}/staff/{uid}.
 *
 * Client-side call pattern:
 *   const token = await auth.currentUser.getIdToken();
 *   fetch('/api/voice/outbound-call', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
 *     body: JSON.stringify({ tenantId, appointmentId, reason: 'reschedule',
 *                            note: 'Jessica is out sick today' }),
 *   });
 *
 * Requires env: RETELL_API_KEY (dashboard → API keys) and
 * RETELL_OUTBOUND_AGENT_ID optional override; from-number is the tenant's
 * voiceAgent.phoneNumber. Verify the create-call endpoint/field names
 * against Retell's current API docs when wiring (shape read/written
 * tolerantly, but their API evolves).
 *
 * Scope guard: outbound is TRANSACTIONAL ONLY — calls to existing clients
 * about their own existing appointments. No marketing/promo calls through
 * this route ever (TCPA territory); that's why `reason` is a closed enum.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, getAdminAuth } from '@/lib/firebase-admin';
import { speakDateTime } from '@/lib/voice/voice-utils';
import { buildTenantVariables } from '@/lib/voice/tenant-variables';
import { placeRetellCall } from '@/lib/voice/retell-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REASONS = ['cancel_notice', 'reschedule'] as const;
type Reason = (typeof REASONS)[number];

async function verifyStaff(
  req: NextRequest,
  tenantId: string,
): Promise<{ ok: true; uid: string } | { ok: false; error: string }> {
  const header = req.headers.get('authorization') || '';
  const idToken = header.replace(/^Bearer\s+/i, '').trim();
  if (!idToken) return { ok: false, error: 'missing_token' };

  let uid: string;
  try {
    const decoded = await getAdminAuth().verifyIdToken(idToken);
    uid = decoded.uid;
  } catch {
    return { ok: false, error: 'invalid_token' };
  }

  const db = getAdminDb();
  const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
  if (!tenantSnap.exists) return { ok: false, error: 'tenant_not_found' };
  if ((tenantSnap.data() as any)?.userId === uid) return { ok: true, uid };

  const staffSnap = await db.doc(`tenants/${tenantId}/staff/${uid}`).get();
  if (staffSnap.exists) return { ok: true, uid };

  return { ok: false, error: 'not_staff' };
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const tenantId: string = body?.tenantId;
  const appointmentId: string = body?.appointmentId;
  const reason: Reason = body?.reason;
  const note: string = (body?.note || '').trim();

  if (!tenantId || !appointmentId || !REASONS.includes(reason)) {
    return NextResponse.json(
      { ok: false, error: 'missing_params' },
      { status: 400 },
    );
  }

  const auth = await verifyStaff(req, tenantId);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  if (!process.env.RETELL_API_KEY) {
    return NextResponse.json(
      { ok: false, error: 'retell_not_configured', reason: 'RETELL_API_KEY env var is not set.' },
      { status: 500 },
    );
  }

  try {
    const db = getAdminDb();

    const [tenantSnap, aptSnap] = await Promise.all([
      db.doc(`tenants/${tenantId}`).get(),
      db.doc(`tenants/${tenantId}/appointments/${appointmentId}`).get(),
    ]);
    const tenant = tenantSnap.data() as any;
    if (!aptSnap.exists) {
      return NextResponse.json({ ok: false, error: 'appointment_not_found' }, { status: 404 });
    }
    const apt = { id: aptSnap.id, ...(aptSnap.data() as any) };

    const fromNumber: string = (tenant?.voiceAgent?.phoneNumber || '').trim();
    if (!fromNumber) {
      return NextResponse.json(
        { ok: false, error: 'no_assistant_number', reason: 'Set the assistant phone number in Voice Assistant settings first.' },
        { status: 400 },
      );
    }

    // Client phone: appointment's client doc first, then any phone on the apt
    let toNumber = '';
    let clientFirstName = 'the client';
    if (apt.clientId) {
      const clientSnap = await db
        .doc(`tenants/${tenantId}/clients/${apt.clientId}`)
        .get();
      if (clientSnap.exists) {
        const c = clientSnap.data() as any;
        toNumber = (c.phone || '').trim();
        clientFirstName = (c.name || '').split(' ')[0] || clientFirstName;
      }
    }
    if (!toNumber) {
      return NextResponse.json(
        { ok: false, error: 'no_client_phone', reason: 'This client has no phone number on file.' },
        { status: 400 },
      );
    }

    // Compose the human-readable task the agent executes on this call
    const tz = tenant?.timezone || 'America/New_York';
    const [svcSnap, staffSnap] = await Promise.all([
      apt.serviceId ? db.doc(`tenants/${tenantId}/services/${apt.serviceId}`).get() : Promise.resolve(null),
      apt.staffId ? db.doc(`tenants/${tenantId}/staff/${apt.staffId}`).get() : Promise.resolve(null),
    ]);
    const svcName = (svcSnap?.data() as any)?.name || 'appointment';
    const providerFirst = ((staffSnap?.data() as any)?.name || '').split(' ')[0];
    const start = typeof apt.startTime === 'string' ? new Date(apt.startTime) : null;
    const aptSpoken = `${svcName}${providerFirst ? ` with ${providerFirst}` : ''}${
      start && !Number.isNaN(start.getTime()) ? ` on ${speakDateTime(start, tz)}` : ''
    }`;

    const outboundTask =
      reason === 'cancel_notice'
        ? `You are calling ${clientFirstName} on behalf of the business to let them know their ${aptSpoken} unfortunately has to be cancelled${note ? ` because ${note}` : ''}. Apologize sincerely. Offer to rebook right now — check availability and offer a few options, including other providers if they're open to it. If they rebook, save it with create_callback_draft. If they'd rather not decide now, log a "message" with log_call_intent so the team follows up. If it goes to voicemail, leave a brief message asking them to call back, without details beyond the appointment needing to be moved.`
        : `You are calling ${clientFirstName} on behalf of the business because their ${aptSpoken} needs to be rescheduled${note ? ` because ${note}` : ''}. Apologize sincerely. Offer the SAME day and time with a different provider first if one is open (use check_availability), then other times. When they agree on a slot, log it with log_call_intent intent "reschedule" using appointmentId ${apt.id} and the agreed slot's startISO. If they'd rather cancel, log intent "cancel" with that appointmentId. If voicemail, leave a brief call-back message without details.`;

    const dynamicVariables = await buildTenantVariables(db, tenantId, tenant);

    const call = await placeRetellCall({
      fromNumber,
      toNumber,
      dynamicVariables: {
        ...dynamicVariables,
        call_direction: 'outbound',
        outbound_task: outboundTask,
      },
      metadata: { tenantId, appointmentId, outboundReason: reason, triggeredBy: auth.uid },
    });
    if (!call.ok) {
      console.error('[voice/outbound-call] retell error', call.error);
      return NextResponse.json({ ok: false, error: 'retell_error', reason: call.error });
    }

    // The call-events webhook will store the recording/transcript when the
    // call ends (metadata.tenantId flows through), so nothing to write here.
    return NextResponse.json({
      ok: true,
      callId: call.callId || null,
      toNumber,
      task: reason,
    });
  } catch (e) {
    console.error('[voice/outbound-call]', e);
    return NextResponse.json({ ok: false, error: 'internal' }, { status: 500 });
  }
}
