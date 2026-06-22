/**
 * src/app/api/opal/recovery-spawn/route.ts
 *
 * Called by CLIENT-side confirm paths (reschedule dialog, cancel hook) the
 * instant a slot is vacated. Server-side functions (handle-no-show-action)
 * call the engine directly instead. This one route does both jobs the moment a
 * disruption confirms:
 *
 *   1. appends the BEHAVIOR event (reschedule / late_cancel / no_show), so the
 *      reliability ledger is the single source of that fact, and
 *   2. spawns the RECOVERY ticket for the vacated slot with zero gap.
 *
 * For a reschedule the appointment's own times were already moved, so the
 * vacated (old) slot times are passed explicitly. For a cancel they default to
 * the appointment's current times.
 */

import { NextRequest, NextResponse } from 'next/server';
import { spawnRecoveryTicket } from '@/lib/opal/recovery-engine';
import { appendBehaviorEvent } from '@/lib/opal/behavior-ledger';
import type { BehaviorEventType } from '@/lib/opal/resolution-engine';

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin';
  let app = getApps().find((a: any) => a.name === APP_NAME);
  if (!app) {
    app = initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    }, APP_NAME);
  }
  return getFirestore(app);
}

const cents = (v: any): number => {
  if (typeof v === 'number') return Math.round(v > 10000 ? v : v * 100); // tolerate dollars or cents
  return 0;
};

export async function POST(req: NextRequest) {
  let body: any = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }

  const {
    tenantId, appointmentId, resolutionTicketId, clientId,
    eventType,                  // 'reschedule' | 'late_cancel' | 'no_show'
    vacatedSlotStart, vacatedSlotEnd, locationId = null,
    skipBehavior = false,       // true for business-initiated cancels (not the client's fault)
  } = body;

  if (!tenantId || !appointmentId || !resolutionTicketId || !eventType) {
    return NextResponse.json({ error: 'Missing tenantId, appointmentId, resolutionTicketId, or eventType' }, { status: 400 });
  }

  try {
    const db = getAdminDb();

    // Read the appointment for provider/service/duration/value. Provider and
    // service don't change on a reschedule, so the current row is correct even
    // after a move-in-place; only the vacated TIMES are passed explicitly.
    const apptSnap = await db.doc(`tenants/${tenantId}/appointments/${appointmentId}`).get();
    const appt = apptSnap.exists ? apptSnap.data() : {};

    const slotStart = vacatedSlotStart || appt?.startTime;
    const slotEnd   = vacatedSlotEnd   || appt?.endTime;
    if (!slotStart || !slotEnd) {
      return NextResponse.json({ error: 'Could not resolve vacated slot times' }, { status: 400 });
    }

    const durationMinutes = appt?.durationMinutes
      || Math.max(15, Math.round((new Date(slotEnd).getTime() - new Date(slotStart).getTime()) / 60000));
    const valueCents = appt?.totalCents ?? appt?.priceCents ?? cents(appt?.price ?? appt?.total ?? 0);

    // A no-show on a slot the client themselves CLAIMED via recovery is weighed
    // leniently — they were doing the business a favor (3.4).
    const weightContext = appt?.source === 'recovery' && eventType === 'no_show'
      ? 'recovery_fill' as const
      : 'normal' as const;

    // 1. Behavior event — the single source of this fact (unless business-initiated).
    if (!skipBehavior) {
      await appendBehaviorEvent(db, {
        tenantId,
        clientId: clientId || appt?.clientId,
        eventType: eventType as BehaviorEventType,
        weightContext,
        locationId,
        resolutionTicketId,
      });
    }

    // 2. Recovery ticket for the vacated slot — zero gap.
    const recoveryTicketId = await spawnRecoveryTicket(db, {
      tenantId,
      resolutionTicketId,
      locationId,
      providerId: appt?.staffId || appt?.providerId || '',
      resourceIds: appt?.resourceIds || [],
      serviceId: appt?.serviceId || '',
      durationMinutes,
      slotStart,
      slotEnd,
      originalAppointmentValueCents: valueCents,
    });

    return NextResponse.json({ ok: true, recoveryTicketId });
  } catch (err: any) {
    console.error('[recovery-spawn]', err);
    return NextResponse.json({ ok: false, error: err?.message || 'Spawn failed' }, { status: 500 });
  }
}
