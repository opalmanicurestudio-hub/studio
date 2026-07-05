/**
 * POST /api/voice/check-availability — v1
 *
 * Called by the voice platform (Vapi/Retell/etc.) as a tool when a caller
 * asks about openings. Auth: x-voice-secret header. Returns 200 with a
 * structured body even on "failure" cases (service not found, no slots) —
 * voice agents handle { error, spokenSummary } far more gracefully than HTTP
 * errors, which tend to surface as "something went wrong" to the caller.
 *
 * Request body:
 * {
 *   "tenantId": "...",                 // configure as a fixed param in the
 *                                      // platform's tool definition
 *   "serviceId": "svc_gel_full",       // OR serviceName for fuzzy match
 *   "serviceName": "gel full set",
 *   "providerId": "prov_jessica",      // optional; OR providerName; omit = any
 *   "providerName": "Jessica",
 *   "dateRangeStart": "2026-07-07",
 *   "dateRangeEnd": "2026-07-10",      // optional, default = start, cap 7 days
 *   "preferredTimeOfDay": "afternoon", // optional: morning | afternoon | evening
 *   "maxOptions": 4,                   // optional, 1-6
 *   "minLeadMinutes": 30               // optional lead-time floor
 * }
 *
 * Response: { slots: VoiceSlot[], spokenSummary, serviceId, serviceName,
 *             providerId | null } or { slots: [], error, spokenSummary }.
 * All spoken* fields are pre-formatted in the tenant's timezone so the agent
 * never reads ISO timestamps aloud.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyVoiceSecret } from '@/lib/voice/voice-utils';
import {
  loadTenantContext,
  resolveService,
  resolveProvider,
  computeAvailability,
} from '@/lib/voice/server-availability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!verifyVoiceSecret(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({
      slots: [],
      error: 'invalid_json',
      spokenSummary: "I'm having trouble checking the calendar right now.",
    });
  }

  const tenantId: string = body?.tenantId;
  const dateRangeStart: string = body?.dateRangeStart;
  if (!tenantId || !/^\d{4}-\d{2}-\d{2}$/.test(dateRangeStart || '')) {
    return NextResponse.json({
      slots: [],
      error: 'missing_params',
      spokenSummary:
        'I need a date to check. What day were you thinking of coming in?',
    });
  }

  try {
    const db = getAdminDb();
    const ctx = await loadTenantContext(db, tenantId);

    const service = resolveService(ctx, {
      serviceId: body.serviceId,
      serviceName: body.serviceName,
    });
    if (!service) {
      return NextResponse.json({
        slots: [],
        error: 'service_not_found',
        spokenSummary: `I couldn't find a service matching "${
          body.serviceName || body.serviceId || ''
        }". Could you tell me a bit more about what you'd like done?`,
      });
    }

    let provider: any | null = null;
    if (body.providerId || body.providerName) {
      provider = resolveProvider(ctx, {
        providerId: body.providerId,
        providerName: body.providerName,
      });
      // A named-but-unmatched provider is an error the agent should clarify,
      // not something to silently widen to "anyone".
      const namedSomeone =
        (body.providerId && body.providerId !== 'any') ||
        (body.providerName &&
          !['any', 'anyone', 'any available'].includes(
            String(body.providerName).trim().toLowerCase(),
          ));
      if (!provider && namedSomeone) {
        return NextResponse.json({
          slots: [],
          error: 'provider_not_found',
          spokenSummary: `I couldn't find a provider named ${body.providerName || body.providerId}. Would you like me to check with anyone available?`,
        });
      }
    }

    const timeOfDay = ['morning', 'afternoon', 'evening'].includes(
      body.preferredTimeOfDay,
    )
      ? body.preferredTimeOfDay
      : undefined;

    const { slots, spokenSummary } = await computeAvailability(db, tenantId, ctx, {
      service,
      provider,
      dateRangeStart,
      dateRangeEnd: body.dateRangeEnd,
      timeOfDay,
      maxOptions: body.maxOptions,
      minLeadMinutes: body.minLeadMinutes,
    });

    return NextResponse.json({
      slots,
      spokenSummary,
      serviceId: service.id,
      serviceName: service.name,
      providerId: provider?.id ?? null,
    });
  } catch (e) {
    console.error('[voice/check-availability]', e);
    return NextResponse.json({
      slots: [],
      error: 'internal',
      spokenSummary:
        "I'm having trouble reaching the calendar right now. I can take your details and have someone call you back to confirm a time.",
    });
  }
}
