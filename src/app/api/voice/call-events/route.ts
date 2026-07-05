/**
 * POST /api/voice/call-events — v1
 *
 * Retell's call-lifecycle webhook receiver. Two events matter:
 *
 *   call_ended    — fires when the call hangs up: recording_url, full
 *                   transcript, timestamps, disconnection reason
 *   call_analyzed — fires ~seconds later: AI call summary, caller
 *                   sentiment, call-successful flag
 *
 * Both merge into ONE doc at tenants/{tenantId}/voiceCalls/{callId}
 * (keyed by Retell's call_id, so the second event enriches rather than
 * duplicates). This is what powers the in-app call log: playback,
 * transcripts, and the decision-making review loop.
 *
 * Tenant attribution: the inbound-webhook route returns
 * metadata: { tenantId } when the call starts; Retell echoes that metadata
 * on every subsequent event. Fallback: the tenant_id dynamic variable.
 * Events with no resolvable tenant are acknowledged and skipped (200 —
 * never make Retell retry-storm over an unconfigured number).
 *
 * Recording storage note: recording_url points at audio RETELL hosts, and
 * their retention window applies (check/set it in their dashboard — and
 * note recordings of calls may have consent/notice requirements; NC is
 * one-party consent, but a "calls may be recorded" line in the greeting is
 * cheap insurance for a multi-state SaaS). If long-term retention matters
 * later, a v2 of this route can download the audio and re-upload to
 * Firebase Storage before saving. URL-only is right for v1.
 *
 * Setup in Retell: agent settings → webhook URL →
 *   https://YOUR-DOMAIN/api/voice/call-events?secret=VOICE_AGENT_SECRET
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { stripUndefined } from '@/lib/voice/voice-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HANDLED_EVENTS = ['call_ended', 'call_analyzed'];

export async function POST(req: NextRequest) {
  if (req.nextUrl.searchParams.get('secret') !== process.env.VOICE_AGENT_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ received: true });
  }

  const event: string = body?.event || '';
  if (!HANDLED_EVENTS.includes(event)) {
    return NextResponse.json({ received: true }); // call_started etc. — ack and ignore
  }

  const call: any = body?.call || {};
  const callId: string = call.call_id || call.callId || '';
  const tenantId: string =
    call?.metadata?.tenantId ||
    call?.retell_llm_dynamic_variables?.tenant_id ||
    '';

  if (!callId || !tenantId) {
    return NextResponse.json({ received: true, skipped: true });
  }

  try {
    const db = getAdminDb();

    const startMs = Number(call.start_timestamp) || null;
    const endMs = Number(call.end_timestamp) || null;
    const analysis = call.call_analysis || {};

    await db.doc(`tenants/${tenantId}/voiceCalls/${callId}`).set(
      stripUndefined({
        id: callId,
        tenantId,
        source: 'retell',
        direction: call.direction || 'inbound',
        fromNumber: call.from_number || undefined,
        toNumber: call.to_number || undefined,
        startedAt: startMs ? new Date(startMs).toISOString() : undefined,
        endedAt: endMs ? new Date(endMs).toISOString() : undefined,
        durationSeconds:
          startMs && endMs ? Math.round((endMs - startMs) / 1000) : undefined,
        disconnectionReason: call.disconnection_reason || undefined,
        recordingUrl: call.recording_url || undefined,
        transcript: call.transcript || undefined,
        // call_analyzed enrichment:
        summary: analysis.call_summary || undefined,
        sentiment: analysis.user_sentiment || undefined, // Positive | Neutral | Negative
        callSuccessful:
          typeof analysis.call_successful === 'boolean'
            ? analysis.call_successful
            : undefined,
        updatedAt: new Date().toISOString(),
      }),
      { merge: true }, // call_ended writes first, call_analyzed enriches
    );

    return NextResponse.json({ received: true });
  } catch (e) {
    console.error('[voice/call-events]', e);
    // Still 200 — a Firestore hiccup shouldn't trigger Retell retry storms;
    // the next event for the same call merges what it can.
    return NextResponse.json({ received: true, error: 'internal' });
  }
}
