/**
 * POST /api/voice/run-virtual-consultations — v1
 *
 * Paid, SCHEDULED virtual consultations conducted by the AI assistant.
 * The consultation is a normal service in the services collection (price,
 * duration, deposit policy — all standard), booked through any channel
 * like any other appointment. The business marks WHICH service is the
 * AI-conducted consultation via voiceAgent.consultationServiceId (settings
 * card dropdown). At the appointment time, this route places the outbound
 * call and the agent conducts the full session from the tenant's
 * consultation guide — then offers to book the actual service on the same
 * call (create_booking is right there), closing the consult → booking
 * revenue chain.
 *
 * Timing: designed for a FREQUENT cron — every 5 minutes (GitHub Actions
 * cron expression: asterisk-slash-5 in the minutes field). Window:
 * appointments starting between 2 minutes
 * ago and 3 minutes from now. Attempt tracking on the appointment
 * (consultationAttempts) allows ONE retry on the next cron tick if the
 * first attempt didn't connect, then an inbox item asks staff to
 * reschedule — the client paid; a missed call must be visible.
 *
 * Completion marking happens in call-events: calls placed here carry
 * metadata.outboundReason 'virtual_consultation' + appointmentId, and on
 * call_ended the appointment gets consultationConductedAt stamped.
 *
 * Only status 'confirmed' appointments are called — deposit_pending means
 * the client hasn't paid for the consult yet, and the completion-link flow
 * owns chasing that.
 *
 * Cron:
 *   curl -s -X POST "$APP_URL/api/voice/run-virtual-consultations" \
 *     -H "Content-Type: application/json" \
 *     -H "x-voice-secret: $VOICE_AGENT_SECRET" \
 *     -d '{"tenantId":"YOUR_TENANT_ID"}'
 */

import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyVoiceSecret, stripUndefined, speakTime } from '@/lib/voice/voice-utils';
import { loadTenantContext } from '@/lib/voice/server-availability';
import { buildTenantVariables } from '@/lib/voice/tenant-variables';
import { placeRetellCall } from '@/lib/voice/retell-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WINDOW_BEFORE_MS = 2 * 60_000; // call up to 2 min late
const WINDOW_AFTER_MS = 3 * 60_000; // or up to 3 min early
const MAX_ATTEMPTS = 2;

export async function POST(req: NextRequest) {
  if (!verifyVoiceSecret(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* tenantId check below */
  }
  const tenantId: string = body?.tenantId;
  if (!tenantId) {
    return NextResponse.json({ placed: 0, error: 'missing_tenant' }, { status: 400 });
  }

  try {
    const db = getAdminDb();
    const ctx = await loadTenantContext(db, tenantId);
    const tenant = ctx.tenant || {};
    const va = tenant.voiceAgent || {};

    const consultationServiceId = (va.consultationServiceId || '').trim();
    const fromNumber = (va.phoneNumber || '').trim();
    if (!consultationServiceId) {
      return NextResponse.json({ placed: 0, skipped: 'no_consultation_service' });
    }
    if (!fromNumber) {
      return NextResponse.json({ placed: 0, skipped: 'no_assistant_number' });
    }

    const now = Date.now();
    const windowStartISO = new Date(now - WINDOW_BEFORE_MS).toISOString();
    const windowEndISO = new Date(now + WINDOW_AFTER_MS).toISOString();

    const snap = await db
      .collection(`tenants/${tenantId}/appointments`)
      .where('startTime', '>=', windowStartISO)
      .where('startTime', '<=', windowEndISO)
      .get();

    const due = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as any) }))
      .filter(
        (a) =>
          a.serviceId === consultationServiceId &&
          a.status === 'confirmed' &&
          !a.consultationConductedAt &&
          (Number(a.consultationAttempts) || 0) < MAX_ATTEMPTS,
      );

    if (due.length === 0) return NextResponse.json({ placed: 0 });

    const dynamicBase = await buildTenantVariables(db, tenantId, tenant);
    const svc = ctx.services.find((s: any) => s.id === consultationServiceId);
    let placed = 0;
    const results: any[] = [];

    for (const apt of due) {
      let toNumber = '';
      let firstName = 'there';
      let clientId: string | null = apt.clientId || null;
      if (clientId) {
        const cSnap = await db.doc(`tenants/${tenantId}/clients/${clientId}`).get();
        if (cSnap.exists) {
          const c = cSnap.data() as any;
          toNumber = (c.phone || '').trim();
          firstName = (c.name || '').split(' ')[0] || firstName;
        }
      }
      if (!toNumber) toNumber = (apt.voiceMeta?.clientPhone || '').trim();

      const attempts = (Number(apt.consultationAttempts) || 0) + 1;
      const isLastAttempt = attempts >= MAX_ATTEMPTS;

      // Track the attempt BEFORE dialing — cron overlap safety.
      await db.doc(`tenants/${tenantId}/appointments/${apt.id}`).set(
        {
          consultationAttempts: attempts,
          consultationLastAttemptAt: new Date().toISOString(),
        },
        { merge: true },
      );

      if (!toNumber) {
        // Paid session, no phone — staff must see this immediately.
        const inboxId = nanoid();
        await db.doc(`tenants/${tenantId}/voiceInbox/${inboxId}`).set(
          stripUndefined({
            id: inboxId,
            tenantId,
            createdAt: new Date().toISOString(),
            intent: 'message',
            callerName: apt.clientName || 'Client',
            callerPhone: '',
            clientId,
            appointmentId: apt.id,
            details: `Scheduled virtual consultation could not be placed — no phone number on file. Reach out to reschedule.`,
            status: 'open',
            source: 'ai_receptionist',
          }),
        );
        results.push({ appointmentId: apt.id, skipped: 'no_phone' });
        continue;
      }

      const timeSpoken = speakTime(new Date(apt.startTime), ctx.timezone);
      const outboundTask = `This is ${firstName}'s SCHEDULED, PAID virtual consultation (${svc?.name || 'consultation'}, booked for ${timeSpoken} — you are calling right on time). Open with: "Hi ${firstName}, it's {{agent_name}} from {{studio_name}} — calling for your ${svc?.name || 'consultation'}! Is now still a good time?" If yes: conduct the full consultation using the consultation guide, one question at a time, with warmth and genuine curiosity — this is a paid session, so be thorough and let them talk. Never give medical advice; note pain, damage, or infection signs as red flags and say their provider will review them. When the guide is complete: summarize what you heard, suggest which services fit best from the Knowledge section, and call log_call_intent with intent "consultation" and the full structured payload including appointmentId ${apt.id} in details. THEN offer to book the recommended service right now — use check_availability and create_booking as normal. If they need to move THIS consultation instead: log_call_intent intent "reschedule" with appointmentId ${apt.id}. If NO ANSWER: ${
        isLastAttempt
          ? 'leave a warm voicemail apologizing for missing them, saying the team will reach out to rebook their consultation, then call log_call_intent intent "message" with appointmentId ' + apt.id + ' and details "Virtual consultation — client did not answer after two attempts, needs rescheduling."'
          : 'leave a brief voicemail that you will try once more in a few minutes, and end the call.'
      }`;

      const call = await placeRetellCall({
        fromNumber,
        toNumber,
        dynamicVariables: {
          ...dynamicBase,
          call_direction: 'outbound',
          outbound_task: outboundTask,
        },
        metadata: {
          tenantId,
          appointmentId: apt.id,
          outboundReason: 'virtual_consultation',
        },
      });

      if (call.ok) placed += 1;
      results.push({ appointmentId: apt.id, attempt: attempts, ok: call.ok, error: call.error });
    }

    return NextResponse.json({ placed, considered: due.length, results });
  } catch (e) {
    console.error('[voice/run-virtual-consultations]', e);
    return NextResponse.json({ placed: 0, error: 'internal' }, { status: 500 });
  }
}
