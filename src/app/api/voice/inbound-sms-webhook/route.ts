/**
 * POST /api/voice/inbound-sms-webhook — v1
 *
 * THE SMS COUNTERPART to inbound-webhook.ts. Retell calls this the moment
 * an inbound TEXT arrives on a tenant's number, the same way
 * inbound-webhook.ts handles the moment a CALL arrives — same tenant
 * resolution, same dynamic-variable compilation, because as of the
 * dedicated-per-tenant-number decision, voice and SMS now share the exact
 * same number per tenant (tenant.voiceAgent.phoneNumber). This is why this
 * webhook can reuse buildTenantVariables() unchanged rather than needing
 * its own compiler.
 *
 * This is what makes "clients can text to book/cancel/reschedule" work
 * with almost no new tool-building: create-booking, log-call-intent,
 * sell-package, sell-membership, and update-notification-preference are
 * ALL already channel-agnostic API routes — Retell's text-based Chat Agent
 * calls the identical functions/tools a phone call does. Nothing about
 * those routes needed to change for this to work.
 *
 * Setup in Retell: on the SAME phone number already configured for voice,
 * enable SMS (per Retell's docs — requires A2P 10DLC to have passed for a
 * custom Twilio number), then set this URL as the inbound SMS/chat webhook:
 *   https://YOUR-DOMAIN/api/voice/inbound-sms-webhook?secret=VOICE_AGENT_SECRET
 *
 * Auth: same query-param secret as inbound-webhook.ts, for the same reason
 * (no Retell SDK dependency needed just to verify a header/param).
 *
 * NOTE: payload shape is inferred from Retell's general webhook
 * conventions (tolerant reads, same as inbound-webhook.ts) — verify the
 * exact SMS/chat webhook field names against Retell's current docs when
 * wiring this in, the same caution inbound-webhook.ts's own header
 * comment already gives for voice.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import {
  buildTenantVariables,
  DEFAULT_AGENT_NAME,
} from '@/lib/voice/tenant-variables';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (req.nextUrl.searchParams.get('secret') !== process.env.VOICE_AGENT_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* fall through to fallback response */
  }

  // Tolerant payload read, same pattern as inbound-webhook.ts — Retell's
  // SMS/chat webhook shape may nest differently than call_inbound; verify
  // against current docs and adjust this destructuring if needed.
  const inbound = body?.sms_inbound || body?.chat_inbound || body || {};
  const toNumber: string = inbound.to_number || inbound.toNumber || '';
  const fromNumber: string = inbound.from_number || inbound.fromNumber || '';
  const messageBody: string = (inbound.message_body || inbound.body || inbound.text || '').trim();

  const fallback = {
    dynamic_variables: {
      tenant_id: '',
      agent_name: DEFAULT_AGENT_NAME,
      studio_name: 'this business',
      business_niche: '',
      knowledge_base:
        'This number is not fully configured for text yet. Let the person know someone will follow up, and take down what they need.',
      has_transfer: 'false',
      transfer_number: '',
      call_direction: 'inbound',
      channel: 'sms',
      outbound_task: '',
    },
    metadata: { tenantId: '' },
  };

  try {
    if (!toNumber) return NextResponse.json(fallback);

    const db = getAdminDb();
    // Same field as voice — tenant.voiceAgent.phoneNumber — since the
    // dedicated-per-tenant-number decision means one number now serves
    // both channels. No separate smsAgent.phoneNumber field needed.
    const tenantQuery = await db
      .collection('tenants')
      .where('voiceAgent.phoneNumber', '==', toNumber)
      .limit(1)
      .get();

    if (tenantQuery.empty) {
      console.warn('[voice/inbound-sms-webhook] no tenant for number', toNumber);
      return NextResponse.json(fallback);
    }

    const tenantDoc = tenantQuery.docs[0];
    const tenant = tenantDoc.data() as any;
    const tenantId = tenantDoc.id;

    // v22 — keyword short-circuit for CONFIRM/CANCEL replies to a
    // reminder. The point of this block: the actual state change (marking
    // confirmed, or executing a cancellation) happens HERE,
    // deterministically, in code — not left to the AI to interpret. This
    // matters regardless of whether Retell's own contract supports "skip
    // the agent, use this canned reply instead" (unconfirmed) — even if
    // the message still reaches the chat agent afterward, the important
    // part (the actual data change) has already happened correctly. The
    // agent's remaining job is reduced to generating a natural-sounding
    // acknowledgment, a much lower-stakes task than deciding what to do.
    let keywordActionTaken: string | undefined;
    const normalizedBody = messageBody.toUpperCase();
    const isConfirmKeyword = normalizedBody === 'C' || normalizedBody === 'CONFIRM' || normalizedBody === 'YES' || normalizedBody === 'Y';
    const isCancelKeyword = normalizedBody === 'X' || normalizedBody === 'CANCEL' || normalizedBody === 'NO' || normalizedBody === 'N';

    if ((isConfirmKeyword || isCancelKeyword) && fromNumber) {
      const clientQuery = await db.collection(`tenants/${tenantId}/clients`).where('phone', '==', fromNumber).limit(1).get();
      if (!clientQuery.empty) {
        const clientId = clientQuery.docs[0].id;
        // The appointment this reply is actually about: the most recent
        // one a reminder was already sent for, still confirmed. Matches
        // exactly what send-text-reminders just texted them about.
        const aptQuery = await db
          .collection(`tenants/${tenantId}/appointments`)
          .where('clientId', '==', clientId)
          .where('reminderSent', '==', true)
          .where('status', '==', 'confirmed')
          .orderBy('startTime', 'asc')
          .limit(1)
          .get();

        if (!aptQuery.empty) {
          const apt = aptQuery.docs[0];
          if (isConfirmKeyword) {
            await apt.ref.set(
              { confirmedViaReminderReply: true, confirmedAt: new Date().toISOString() },
              { merge: true },
            );
            keywordActionTaken = 'confirmed';
          } else {
            // Reuses log-call-intent's existing cancellation logic
            // (fee gating, safety checks, everything already built)
            // rather than reimplementing any of it here — a keyword
            // reply cancellation goes through the exact same rules as
            // any other cancel.
            try {
              const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.clarityflow.com';
              await fetch(`${appUrl}/api/voice/log-call-intent`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-voice-secret': process.env.VOICE_AGENT_SECRET || '',
                },
                body: JSON.stringify({
                  tenantId,
                  clientId,
                  appointmentId: apt.id,
                  intent: 'cancel',
                  callerPhone: fromNumber,
                }),
              });
              keywordActionTaken = 'cancel_requested';
            } catch {
              /* non-fatal — falls through to normal agent handling below */
            }
          }
        }
      }
    }

    const dynamicVariables = await buildTenantVariables(db, tenantId, tenant);

    return NextResponse.json({
      dynamic_variables: {
        ...dynamicVariables,
        call_direction: 'inbound',
        channel: 'sms',
        outbound_task: '',
        // Tells the agent's prompt a deterministic action already
        // happened — see the task playbook's SMS section for how it
        // should react to this (acknowledge briefly, don't re-derive
        // intent from the raw keyword).
        keyword_action_taken: keywordActionTaken || '',
      },
      metadata: { tenantId },
    });
  } catch (e) {
    console.error('[voice/inbound-sms-webhook]', e);
    return NextResponse.json(fallback);
  }
}
