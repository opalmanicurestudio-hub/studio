/**
 * POST /api/voice/execute-cancel — v1
 *
 * The one-click FEE-FREE cancel for voice-inbox cancel requests. Scope is
 * deliberate: this performs a clean cancellation ONLY — status flip with
 * audit, appointmentCheckIns mirror kept in sync, bookingCompletions
 * voided, inbox item marked handled. It NEVER touches money: no
 * cancellation fee, no card charge, no ledger writes. All fee machinery
 * stays where it lives (AppointmentDetailsSheet) — when a fee should be
 * charged, staff uses the row's "Open" button instead. The panel's button
 * copy makes this split explicit.
 *
 * Auth: staff Firebase ID token, same as execute-reschedule.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaff } from '@/lib/voice/staff-auth';

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
  const inboxItemId: string | undefined = body?.inboxItemId;

  if (!tenantId || !appointmentId) {
    return NextResponse.json({ ok: false, error: 'missing_params' }, { status: 400 });
  }

  const auth = await verifyStaff(req, tenantId);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  try {
    const db = getAdminDb();
    const aptSnap = await db.doc(`tenants/${tenantId}/appointments/${appointmentId}`).get();
    if (!aptSnap.exists) {
      return NextResponse.json({ ok: false, error: 'appointment_not_found' }, { status: 404 });
    }
    const apt = aptSnap.data() as any;
    if (apt.status === 'cancelled') {
      // Idempotent: mark the inbox row handled and report success.
      if (inboxItemId) {
        await db.doc(`tenants/${tenantId}/voiceInbox/${inboxItemId}`).set(
          { status: 'handled', handledAt: new Date().toISOString(), handledBy: auth.uid },
          { merge: true },
        );
      }
      return NextResponse.json({ ok: true, alreadyCancelled: true });
    }

    const nowISO = new Date().toISOString();
    const cancelPatch = {
      status: 'cancelled',
      cancelledAt: nowISO,
      cancellationReason: 'client_requested_via_voice',
      cancellationFeeCharged: false,
      cancellationAudit: {
        actorType: 'studio',
        actorId: auth.uid,
        reason: 'client_requested_via_voice',
        feeCharged: false,
        timestamp: nowISO,
      },
      updatedAt: nowISO,
    };

    const batch = db.batch();
    batch.set(db.doc(`tenants/${tenantId}/appointments/${appointmentId}`), cancelPatch, {
      merge: true,
    });
    if (apt.checkInToken) {
      batch.set(db.doc(`appointmentCheckIns/${apt.checkInToken}`), cancelPatch, { merge: true });
      batch.set(
        db.doc(`tenants/${tenantId}/bookingCompletions/${apt.checkInToken}`),
        { status: 'void' },
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
    await batch.commit();

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[voice/execute-cancel]', e);
    return NextResponse.json({ ok: false, error: 'internal' }, { status: 500 });
  }
}
