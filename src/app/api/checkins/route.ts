// src/app/api/checkins/route.ts
//
// v79 — Step 5 of the rules migration: appointmentCheckIns was a TOP-LEVEL
// collection with `allow read, write: if true` — the single loudest hole
// in the rules (any client could read or forge any tenant's check-ins).
//
// This API becomes the kiosk's write path. Check-ins land in the scoped
// tenants/{id}/appointmentCheckIns collection (staff-readable, server-
// write-only under the v79 rules) AND mirror to the legacy top-level
// collection during the compatibility window, so surfaces still reading
// the old path keep working. Once the kiosk + all readers use this API /
// the scoped path, close the legacy rule (see firestore.rules comment).
//
// POST { tenantId, token, ...fields } — create/update a check-in (public:
//        the kiosk is unauthenticated by design; shape-validated, size-
//        capped, and rate-limited per tenant).
// GET  ?tenantId=&token= — read one check-in (kiosk status screens).

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

const MAX_FIELD = 300;
const ALLOWED_FIELDS = [
  'appointmentId', 'clientId', 'clientName', 'status', 'checkInToken',
  'checkedInAt', 'partySize', 'notes', 'serviceIds', 'staffId', 'source',
  'checkInStatus', 'lateTimeMinutes', // client self-service status ("on my way", "running late", "arrived")
];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { tenantId, token } = body || {};
    if (!tenantId || !token || typeof token !== 'string' || token.length > 120) {
      return NextResponse.json({ ok: false, error: 'Missing parameters.' }, { status: 400 });
    }
    const db = getAdminDb();

    // Light per-tenant rate limit: 120 kiosk writes / 10 min.
    const rlRef = db.doc(`tenants/${tenantId}/private/checkinRate`);
    const rl = ((await rlRef.get()).data() as any) || {};
    const stamps: number[] = (rl.at || []).filter((t: number) => Date.now() - t < 10 * 60 * 1000);
    if (stamps.length >= 120) {
      return NextResponse.json({ ok: false, error: 'Too many check-ins — try again shortly.' }, { status: 429 });
    }
    await rlRef.set({ at: [...stamps, Date.now()].slice(-200) }, { merge: true });

    // Shape-validate: only allowed fields, strings capped.
    const clean: any = { tenantId, checkInToken: token, updatedAt: new Date().toISOString() };
    for (const k of ALLOWED_FIELDS) {
      if (body[k] === undefined) continue;
      const v = body[k];
      if (typeof v === 'string') clean[k] = v.slice(0, MAX_FIELD);
      else if (typeof v === 'number' || typeof v === 'boolean') clean[k] = v;
      else if (Array.isArray(v)) clean[k] = v.slice(0, 20).map((x: any) => String(x).slice(0, 120));
    }
    // Only default checkedInAt on an actual check-in (kiosk writes include
    // `status`) — a status-only update ("on my way") must NOT stamp arrival.
    if (!clean.checkedInAt && clean.status) clean.checkedInAt = new Date().toISOString();

    // Scoped write (the target state) + legacy mirror (compatibility).
    await db.doc(`tenants/${tenantId}/appointmentCheckIns/${token}`).set(clean, { merge: true });
    await db.doc(`appointmentCheckIns/${token}`).set(clean, { merge: true }); // TODO: remove after legacy rule closes

    // Owner-visible audit trail for self-service status changes.
    if (clean.checkInStatus) {
      try {
        await db.collection(`tenants/${tenantId}/auditLogs`).add({
          action: 'checkin.status',
          targetType: 'appointmentCheckIn',
          targetId: token,
          summary: `${clean.clientName || 'Client'} set check-in status to "${String(clean.checkInStatus).replace(/_/g, ' ')}"${clean.lateTimeMinutes ? ` (~${clean.lateTimeMinutes} min late)` : ''}`,
          actor: { type: 'user', id: clean.clientId || null, name: clean.clientName || null, role: 'client', via: 'check-in-link' },
          at: new Date().toISOString(),
        });
      } catch { /* audit failures are non-fatal */ }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[checkins] POST failed', err);
    return NextResponse.json({ ok: false, error: 'Could not record check-in.' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get('tenantId');
    const token = searchParams.get('token');
    if (!tenantId || !token) return NextResponse.json({ ok: false, error: 'Missing parameters.' }, { status: 400 });
    const db = getAdminDb();
    const scoped = await db.doc(`tenants/${tenantId}/appointmentCheckIns/${token}`).get();
    if (scoped.exists) return NextResponse.json({ ok: true, checkIn: scoped.data() });
    const legacy = await db.doc(`appointmentCheckIns/${token}`).get();
    const data = legacy.exists ? (legacy.data() as any) : null;
    if (data && data.tenantId !== tenantId) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
    return data
      ? NextResponse.json({ ok: true, checkIn: data })
      : NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
  } catch (err) {
    console.error('[checkins] GET failed', err);
    return NextResponse.json({ ok: false, error: 'Could not read check-in.' }, { status: 500 });
  }
}
