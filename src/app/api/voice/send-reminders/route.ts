/**
 * POST /api/voice/send-reminders — v1
 *
 * Cron-driven outbound appointment reminders BY VOICE. What makes this
 * better than an SMS blast: the reminder is a full agent call, so "actually
 * I can't make it" becomes a live reschedule (check_availability + a
 * reschedule intent) instead of a lost booking.
 *
 * Selection: confirmed appointments whose start is within the
 * appointment's own reminder window (apt.reminderHours, default 48 — the
 * field QuickBookForm already writes) and at least 1h away, not yet
 * reminded. Marks reminderSent BEFORE placing the call so a cron overlap
 * can never double-call anyone. Confirmations are deliberately NOT logged
 * to the inbox (the transcript records them); only changes are.
 *
 * Guardrails:
 *   - tenant opt-in: voiceAgent.voiceReminders === true, plus an assistant
 *     number configured
 *   - quiet hours: only places calls 9:00 AM–7:59 PM tenant-local
 *   - MAX_PER_RUN cap bounds cost per cron tick
 *   - deposit_pending appointments are skipped (the completion-link flow
 *     owns nudging those)
 *
 * Query design: single-field startTime range, all other filtering in
 * memory — no composite index (as always).
 *
 * Cron (same GitHub Actions workflow as release-stale, e.g. hourly):
 *   curl -s -X POST "$APP_URL/api/voice/send-reminders" \
 *     -H "Content-Type: application/json" \
 *     -H "x-voice-secret: $VOICE_AGENT_SECRET" \
 *     -d '{"tenantId":"YOUR_TENANT_ID"}'
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyVoiceSecret, localHour, speakDateTime } from '@/lib/voice/voice-utils';
import { loadTenantContext } from '@/lib/voice/server-availability';
import { buildTenantVariables } from '@/lib/voice/tenant-variables';
import { placeRetellCall } from '@/lib/voice/retell-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_PER_RUN = 10;
const QUIET_START_HOUR = 9; // no calls before 9 AM local
const QUIET_END_HOUR = 20; // no calls at/after 8 PM local

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

    if (va.voiceReminders !== true) {
      return NextResponse.json({ placed: 0, skipped: 'voice_reminders_disabled' });
    }
    const fromNumber = (va.phoneNumber || '').trim();
    if (!fromNumber) {
      return NextResponse.json({ placed: 0, skipped: 'no_assistant_number' });
    }

    const hourLocal = localHour(new Date(), ctx.timezone);
    if (hourLocal < QUIET_START_HOUR || hourLocal >= QUIET_END_HOUR) {
      return NextResponse.json({ placed: 0, skipped: 'quiet_hours' });
    }

    // Widest possible window (72h) in one range query; per-appointment
    // reminderHours narrows in memory.
    const now = Date.now();
    const nowISO = new Date(now).toISOString();
    const horizonISO = new Date(now + 72 * 3600 * 1000).toISOString();
    const snap = await db
      .collection(`tenants/${tenantId}/appointments`)
      .where('startTime', '>=', nowISO)
      .where('startTime', '<=', horizonISO)
      .get();

    const due = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as any) }))
      .filter((a) => {
        if (a.status !== 'confirmed') return false;
        if (a.reminderSent === true) return false;
        if (typeof a.startTime !== 'string') return false;
        const startMs = new Date(a.startTime).getTime();
        if (Number.isNaN(startMs)) return false;
        const hoursUntil = (startMs - now) / 3_600_000;
        const windowHours = Number(a.reminderHours) || 48;
        return hoursUntil >= 1 && hoursUntil <= windowHours;
      })
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
      .slice(0, MAX_PER_RUN);

    if (due.length === 0) return NextResponse.json({ placed: 0 });

    const dynamicBase = await buildTenantVariables(db, tenantId, tenant);
    let placed = 0;
    const results: any[] = [];

    for (const apt of due) {
      // Resolve the client's phone
      let toNumber = '';
      let firstName = 'there';
      if (apt.clientId) {
        const cSnap = await db.doc(`tenants/${tenantId}/clients/${apt.clientId}`).get();
        if (cSnap.exists) {
          const c = cSnap.data() as any;
          toNumber = (c.phone || '').trim();
          firstName = (c.name || '').split(' ')[0] || firstName;
        }
      }

      // Mark BEFORE calling — a cron overlap must never double-call.
      await db.doc(`tenants/${tenantId}/appointments/${apt.id}`).set(
        {
          reminderSent: true,
          reminderSentAt: new Date().toISOString(),
          reminderChannel: toNumber ? 'voice' : 'skipped_no_phone',
        },
        { merge: true },
      );
      if (!toNumber) {
        results.push({ appointmentId: apt.id, skipped: 'no_phone' });
        continue;
      }

      const svc = ctx.services.find((s: any) => s.id === apt.serviceId);
      const staffMember = ctx.staff.find((s: any) => s.id === apt.staffId);
      const start = new Date(apt.startTime);
      const aptSpoken = `${svc?.name || 'appointment'}${
        staffMember?.name ? ` with ${staffMember.name.split(' ')[0]}` : ''
      } on ${speakDateTime(start, ctx.timezone)}`;

      const outboundTask = `You are calling ${firstName} with a friendly reminder of their ${aptSpoken}. Ask if they're all set to make it. If YES: thank them warmly, mention anything relevant from the knowledge base in one sentence at most (like parking), and end the call — do NOT log anything for a simple confirmation. If they need a DIFFERENT time: handle the reschedule right now — use check_availability, agree on a new slot, and call log_call_intent with intent "reschedule", appointmentId ${apt.id}, and the new slot's startISO. If they want to CANCEL: state the cancellation policy if one is in the knowledge base, then log_call_intent intent "cancel" with appointmentId ${apt.id}. If VOICEMAIL: leave a brief reminder with the studio name, the day and time, and ask them to call back if anything needs to change.`;

      const call = await placeRetellCall({
        fromNumber,
        toNumber,
        dynamicVariables: {
          ...dynamicBase,
          call_direction: 'outbound',
          outbound_task: outboundTask,
        },
        metadata: { tenantId, appointmentId: apt.id, outboundReason: 'reminder' },
      });

      if (call.ok) placed += 1;
      results.push({ appointmentId: apt.id, ok: call.ok, error: call.error });
    }

    return NextResponse.json({ placed, considered: due.length, results });
  } catch (e) {
    console.error('[voice/send-reminders]', e);
    return NextResponse.json({ placed: 0, error: 'internal' }, { status: 500 });
  }
}
