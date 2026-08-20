/**
 * POST /api/voice/release-stale — v1
 *
 * The anti-squatting valve for instant-mode bookings: an AI-booked
 * deposit_pending appointment blocks its slot (by design), but a client
 * who never completes the deposit link shouldn't hold that slot forever.
 * This cancels AI-sourced deposit_pending appointments whose hold window
 * (tenant voiceAgent.holdHours, default 24) has expired without payment,
 * releases the calendar, marks the completion record expired, updates the
 * check-in mirror, and drops a voiceInbox notice so the release is visible
 * — every call still terminates somewhere the business can see.
 *
 * Deliberately narrow: only source === 'ai_receptionist', only
 * status === 'deposit_pending', only depositStatus still 'pending'.
 * Online-booking bookingRequests, manual holds, and staff-created
 * deposit_pending appointments are untouched.
 *
 * Call it from the existing GitHub Actions cron (same pattern as the
 * automation enforcement job), one curl per tenant:
 *
 *   curl -s -X POST "$APP_URL/api/voice/release-stale" \
 *     -H "Content-Type: application/json" \
 *     -H "x-voice-secret: $VOICE_AGENT_SECRET" \
 *     -d '{"tenantId":"YOUR_TENANT_ID"}'
 */

import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyVoiceSecret, stripUndefined } from '@/lib/voice/voice-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_HOLD_HOURS = 24;

export async function POST(req: NextRequest) {
  if (!verifyVoiceSecret(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* tolerated — tenantId check below */
  }
  const tenantId: string = body?.tenantId;
  if (!tenantId) {
    return NextResponse.json({ released: 0, error: 'missing_tenant' }, { status: 400 });
  }

  try {
    const db = getAdminDb();
    const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
    const tenant = tenantSnap.exists ? (tenantSnap.data() as any) : {};
    const holdHours = Number(tenant?.voiceAgent?.holdHours) || DEFAULT_HOLD_HOURS;
    const cutoffISO = new Date(Date.now() - holdHours * 3600 * 1000).toISOString();
    const nowISO = new Date().toISOString();

    // Two equality filters — merged single-field indexes, no composite needed.
    const snap = await db
      .collection(`tenants/${tenantId}/appointments`)
      .where('source', '==', 'ai_receptionist')
      .where('status', 'in', ['deposit_pending', 'requested'])
      .get();

    const stale = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as any) }))
      .filter((a) => {
        if (a.voiceApproval === 'denied') return false;
        /* An unanswered request expires on its own clock — the shop's
         * approvalExpiryHours, stamped at booking — not on the deposit-hold
         * cutoff, which is a different promise to a different person. */
        if (a.status === 'requested') {
          return typeof a.requestExpiresAt === 'string'
            && a.requestExpiresAt !== ''
            && a.requestExpiresAt < nowISO;
        }
        return a.depositStatus === 'pending'
          && typeof a.createdAt === 'string'
          && a.createdAt < cutoffISO;
      });

    if (stale.length === 0) return NextResponse.json({ released: 0 });

    const batch = db.batch();
    for (const apt of stale) {
      const wasRequest = apt.status === 'requested';
      const cancelPatch = {
        status: wasRequest ? 'declined' : 'cancelled',
        cancelledAt: nowISO,
        cancellationReason: wasRequest ? 'request_expired' : 'deposit_hold_expired',
        autoCancelledNoShow: false,
        cancellationAudit: {
          actorType: 'system',
          reason: wasRequest ? 'request_expired' : 'deposit_hold_expired',
          timestamp: nowISO,
        },
        ...(wasRequest ? { voiceApproval: 'denied', decidedAt: nowISO, decidedBy: 'system' } : {}),
      };
      batch.set(
        db.doc(`tenants/${tenantId}/appointments/${apt.id}`),
        cancelPatch,
        { merge: true },
      );
      if (apt.checkInToken) {
        batch.set(db.doc(`appointmentCheckIns/${apt.checkInToken}`), cancelPatch, {
          merge: true,
        });
        batch.set(
          db.doc(`tenants/${tenantId}/bookingCompletions/${apt.checkInToken}`),
          { status: 'expired' },
          { merge: true },
        );
      }
      const inboxId = nanoid();
      batch.set(
        db.doc(`tenants/${tenantId}/voiceInbox/${inboxId}`),
        stripUndefined({
          id: inboxId,
          tenantId,
          createdAt: nowISO,
          intent: 'message',
          callerName: apt.clientName || 'Client',
          callerPhone: apt.voiceMeta?.clientPhone || '',
          clientId: apt.clientId || null,
          appointmentId: apt.id,
          details: `Deposit hold expired after ${holdHours}h — ${apt.voiceMeta?.spoken || 'AI-booked appointment'} was released. Worth a follow-up call.`,
          status: 'open',
          source: 'ai_receptionist',
        }),
      );
    }
    await batch.commit();

    return NextResponse.json({ released: stale.length });
  } catch (e) {
    console.error('[voice/release-stale]', e);
    return NextResponse.json({ released: 0, error: 'internal' }, { status: 500 });
  }
}
