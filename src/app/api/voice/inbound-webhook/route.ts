/**
 * POST /api/voice/inbound-webhook — v1
 *
 * THE MULTI-TENANT HEART of the AI receptionist. Retell calls this at the
 * moment an inbound call rings, BEFORE the agent speaks, asking "a call
 * just came in on {to_number} — what should this agent be?" We look up
 * which tenant owns that number and return per-call dynamic variables:
 *
 *   agent_name      — tenant-chosen (default "Chloe")
 *   studio_name     — tenant's business name
 *   tenant_id       — flows into every tool call (no more hardcoding)
 *   business_niche  — one line so the agent talks like it belongs there
 *   knowledge_base  — compiled fresh PER CALL from two sources:
 *                       1. the tenant's freeform FAQ/policies/hours text
 *                          (voiceAgent.knowledgeBase, set in settings)
 *                       2. their LIVE services + prices straight from the
 *                          services collection — never stale
 *   has_transfer / transfer_number — optional; complaints never transfer
 *                     regardless (prompt rule), this only enables
 *                     "caller explicitly asks for a human" during hours
 *
 * One Retell agent template serves every ClarityFlow tenant. Onboarding a
 * new business to voice = buy a number in Retell, attach it to the shared
 * agent, and paste that number into the tenant's Voice Assistant settings
 * card. This route does the rest on every call.
 *
 * Setup in Retell: on the phone number (or agent) settings, set the
 * "inbound call webhook" URL to:
 *   https://YOUR-DOMAIN/api/voice/inbound-webhook?secret=VOICE_AGENT_SECRET
 * Auth is the secret query param (Retell's own header signing would add
 * their SDK as a dependency; the query secret is equivalent protection
 * here). Payload/response shapes are read tolerantly, but verify the
 * current field names against Retell's inbound-webhook docs when wiring.
 *
 * Tenant lookup: exact match on voiceAgent.phoneNumber — store it E.164
 * (+1336...), which is how Retell sends to_number. Unmatched numbers get a
 * safe generic fallback so the call never hard-fails.
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

  // Tolerant payload read — Retell nests under call_inbound
  const inbound = body?.call_inbound || body || {};
  const toNumber: string = inbound.to_number || inbound.toNumber || '';

  const fallback = {
    call_inbound: {
      dynamic_variables: {
        tenant_id: '',
        agent_name: DEFAULT_AGENT_NAME,
        studio_name: 'this business',
        business_niche: '',
        knowledge_base:
          'This line is not fully configured yet. Take a message with the caller name and number and say the team will call back.',
        has_transfer: 'false',
        transfer_number: '',
        call_direction: 'inbound',
        outbound_task: '',
      },
      metadata: { tenantId: '' },
    },
  };

  try {
    if (!toNumber) return NextResponse.json(fallback);

    const db = getAdminDb();
    const tenantQuery = await db
      .collection('tenants')
      .where('voiceAgent.phoneNumber', '==', toNumber)
      .limit(1)
      .get();

    if (tenantQuery.empty) {
      console.warn('[voice/inbound-webhook] no tenant for number', toNumber);
      return NextResponse.json(fallback);
    }

    const tenantDoc = tenantQuery.docs[0];
    const tenant = tenantDoc.data() as any;
    const tenantId = tenantDoc.id;

    const dynamicVariables = await buildTenantVariables(db, tenantId, tenant);

    return NextResponse.json({
      call_inbound: {
        dynamic_variables: {
          ...dynamicVariables,
          call_direction: 'inbound',
          outbound_task: '',
        },
        // Echoed back on every call-lifecycle webhook — how the call-events
        // route knows which tenant a recording/transcript belongs to.
        metadata: { tenantId },
      },
    });
  } catch (e) {
    console.error('[voice/inbound-webhook]', e);
    return NextResponse.json(fallback);
  }
}
