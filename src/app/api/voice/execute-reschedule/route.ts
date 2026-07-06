/**
 * POST /api/voice/execute-reschedule — v1
 *
 * The ONE-CLICK reschedule. A voice-inbox reschedule row already contains
 * everything decided on the call: the appointmentId and the exact agreed
 * startISO (plus provider if one was agreed). This route executes the move
 * atomically with the same guarantees as a new booking:
 *
 *   1. Re-verify the target slot server-side (schedule window, blocked
 *      events, padded appointments — EXCLUDING the appointment being
 *      moved, so shifting 30 minutes within your own footprint works).
 *   2. Claim the target with the slotLocks transaction.
 *   3. One batch: appointment startTime/endTime (+staffId if the provider
 *      changes), rescheduleHistory entry appended, reminderSent reset to
 *      false (a moved appointment deserves a fresh reminder), the
 *      appointmentCheckIns mirror kept in sync, fairness clocks advanced
 *      on a newly-assigned provider, lock released, and the inbox item
 *      marked handled.
 *
 * No money moves in a reschedule, so no human steps beyond the click.
 * If the target slot was taken since the call, returns slot_taken and the
 * panel falls back to "Open" for manual handling.
 *
 * Auth: staff Firebase ID token (Authorization: Bearer), same as
 * outbound-call — this is a staff UI action, not a Retell tool.
 */

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaff } from '@/lib/voice/staff-auth';
import { localDateStr, localTimeHHmm, speakDateTime } from '@/lib/voice/voice-utils';
import {
  loadTenantContext,
  verifySlotOpen,
  fetchDayAppointments,
  resolveProvider,
} from '@/lib/voice/server-availability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const tenantId: string = body?.tenantId;
  const appointmentId: string = body?.appointmentId;
  const newStartISO: string = body?.newStartISO;
  const inboxItemId: string | undefined = body?.inboxItemId;

  if (!tenantId || !appointmentId || !newStartISO) {
    return NextResponse.json({ ok: false, error: 'missing_params' }, { status: 400 });
  }

  const auth = await verifyStaff(req, tenantId);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  try {
    const db = getAdminDb();
    const ctx = await loadTenantContext(db, tenantId);
    const tz = ctx.timezone;

    const aptSnap = await db.doc(`tenants/${tenantId}/appointments/${appointmentId}`).get();
    if (!aptSnap.exists) {
      return NextResponse.json({ ok: false, error: 'appointment_not_found' }, { status: 404 });
    }
    const apt = { id: aptSnap.id, ...(aptSnap.data() as any) };
    if (apt.status === 'cancelled') {
      return NextResponse.json({ ok: false, error: 'already_cancelled' });
    }

    const service = ctx.services.find((s: any) => s.id === apt.serviceId);
    if (!service) {
      return NextResponse.json({ ok: false, error: 'service_not_found' });
    }

    // Provider: explicitly requested on the call, else unchanged.
    const staffMember =
      (body.providerId && resolveProvider(ctx, { providerId: body.providerId })) ||
      ctx.staff.find((s: any) => s.id === apt.staffId);
    if (!staffMember) {
      return NextResponse.json({ ok: false, error: 'provider_not_found' });
    }
    const providerChanged = staffMember.id !== apt.staffId;

    const newStart = new Date(newStartISO);
    if (Number.isNaN(newStart.getTime()) || newStart.getTime() < Date.now()) {
      return NextResponse.json({ ok: false, error: 'invalid_start' });
    }

    // Verify target, excluding the appointment being moved.
    const dateLocal = localDateStr(newStart, tz);
    const dayApts = (await fetchDayAppointments(db, tenantId, ctx, dateLocal)).filter(
      (a) => a.id !== appointmentId,
    );
    const verdict = verifySlotOpen({
      staffMember,
      service,
      startUtc: newStart,
      ctx,
      dayAppointments: dayApts,
    });
    if (!verdict.open) {
      return NextResponse.json({
        ok: false,
        error: verdict.reason === 'slot_taken' ? 'slot_taken' : verdict.reason,
      });
    }

    // Claim the target slot.
    const nowISO = new Date().toISOString();
    const timeLocal = localTimeHHmm(newStart, tz);
    const lockKey = `${staffMember.id}_${dateLocal}_${timeLocal.replace(':', '')}`;
    const lockRef = db.doc(`tenants/${tenantId}/slotLocks/${lockKey}`);
    try {
      await db.runTransaction(async (tx) => {
        const existing = await tx.get(lockRef);
        if (existing.exists) throw new Error('SLOT_TAKEN');
        tx.set(lockRef, {
          staffId: staffMember.id,
          date: dateLocal,
          time: timeLocal,
          aptId: appointmentId,
          reservedAt: nowISO,
          expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        });
      });
    } catch (e: any) {
      if (e?.message === 'SLOT_TAKEN') {
        return NextResponse.json({ ok: false, error: 'slot_taken' });
      }
      throw e;
    }

    // Duration: preserve the existing footprint if end/start were sane,
    // else fall back to the service duration.
    const oldStart = new Date(apt.startTime);
    const oldEnd = new Date(apt.endTime);
    const durationMs =
      !Number.isNaN(oldStart.getTime()) && !Number.isNaN(oldEnd.getTime()) && oldEnd > oldStart
        ? oldEnd.getTime() - oldStart.getTime()
        : (service.duration ?? 60) * 60_000;
    const newEnd = new Date(newStart.getTime() + durationMs);

    const historyEntry = {
      from: apt.startTime,
      to: newStart.toISOString(),
      fromStaffId: apt.staffId,
      toStaffId: staffMember.id,
      at: nowISO,
      by: auth.uid,
      source: 'voice_inbox_one_click',
    };

    const movePatch = {
      startTime: newStart.toISOString(),
      endTime: newEnd.toISOString(),
      staffId: staffMember.id,
      reminderSent: false, // moved appointment gets a fresh reminder
      updatedAt: nowISO,
    };

    const batch = db.batch();
    batch.set(
      db.doc(`tenants/${tenantId}/appointments/${appointmentId}`),
      { ...movePatch, rescheduleHistory: FieldValue.arrayUnion(historyEntry) },
      { merge: true },
    );
    if (apt.checkInToken) {
      batch.set(db.doc(`appointmentCheckIns/${apt.checkInToken}`), movePatch, { merge: true });
    }
    if (providerChanged) {
      batch.set(
        db.doc(`tenants/${tenantId}/staff/${staffMember.id}`),
        { lastBookingAssignedAt: nowISO, lastServedTimestamp: nowISO },
        { merge: true },
      );
    }
    if (inboxItemId) {
      batch.set(
        db.doc(`tenants/${tenantId}/voiceInbox/${inboxItemId}`),
        { status: 'handled', handledAt: nowISO, handledBy: auth.uid },
        { merge: true },
      );
    }
    batch.delete(lockRef);
    await batch.commit();

    return NextResponse.json({
      ok: true,
      appointmentId,
      newStartISO: newStart.toISOString(),
      spoken: speakDateTime(newStart, tz),
      providerChanged,
      providerName: staffMember.name || null,
    });
  } catch (e) {
    console.error('[voice/execute-reschedule]', e);
    return NextResponse.json({ ok: false, error: 'internal' }, { status: 500 });
  }
}
