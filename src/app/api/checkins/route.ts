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

import { resolvePolicy } from '@/lib/booking-policies';
import { arrivalFields } from '@/lib/check-in';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { publicVisitCopy } from '@/lib/public-visit-copy';

const MAX_FIELD = 300;
// What the caller may send. The visit copies are readable with the token, so what lands THERE is cut down again by
// publicVisitCopy: no free-text note, and the client's id and name come from the appointment, not the request.
const ALLOWED_FIELDS = [
  'appointmentId', 'status', 'checkInToken',
  'checkedInAt', 'partySize', 'serviceIds', 'staffId', 'source',
  'checkInStatus', 'lateTimeMinutes', // client self-service status ("on my way", "running late", "arrived")
  'lateNote',                         // optional note with "running late" — kept on the appointment only
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
    // The token must belong to the booking named — otherwise anyone could mark
    // someone else's appointment as arrived or running late.
    // Every write needs the appointment, and the token must be that appointment's own link.
    let appt: any = null;
    let apptId = typeof body.appointmentId === 'string' ? body.appointmentId.slice(0, 120) : '';
    if (apptId && /^[A-Za-z0-9_-]{1,120}$/.test(apptId)) {
      const snap = await db.doc(`tenants/${tenantId}/appointments/${apptId}`).get();
      appt = snap.exists ? (snap.data() as any) : null;
    }
    // Older copies didn't carry the appointment id (the page then sends the token) — find the visit by its link.
    if (!appt) {
      const hit = (await db.collection(`tenants/${tenantId}/appointments`).where('checkInToken', '==', token).limit(1).get()).docs[0];
      if (hit) { appt = hit.data() as any; apptId = String(hit.id); }
    }
    if (!appt || !apptId || appt.checkInToken !== token) return NextResponse.json({ ok: false, error: 'This link doesn’t match that appointment.' }, { status: 403 });
    body.appointmentId = apptId;

    // ── TRIP SHARING (opt-in; ends at check-in). We keep only HOW FAR and a
    // rough ETA — never the client's coordinates.
    if (body.trip !== undefined) {
      const aRef = db.doc(`tenants/${tenantId}/appointments/${String(body.appointmentId)}`);
      if (body.trip === null || body.trip === 'stop') { await aRef.set({ clientTrip: null }, { merge: true }); return NextResponse.json({ ok: true, sharing: false }); }
      const lat = Number(body.trip?.lat), lng = Number(body.trip?.lng);
      const home = ((await db.doc(`tenants/${tenantId}`).get()).data() as any)?.studioLocation;
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return NextResponse.json({ ok: false, error: 'Location unavailable.' }, { status: 400 });
      if (appt.clientTrip?.at && Date.now() - Date.parse(appt.clientTrip.at) < 30000) return NextResponse.json({ ok: true, sharing: true, throttled: true });
      let distanceKm: number | null = null, etaMin: number | null = null;
      if (home && Number.isFinite(Number(home.lat)) && Number.isFinite(Number(home.lng))) {
        const R = 6371, toR = (d: number) => d * Math.PI / 180, dLat = toR(lat - home.lat), dLng = toR(lng - home.lng);
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(home.lat)) * Math.cos(toR(lat)) * Math.sin(dLng / 2) ** 2;
        distanceKm = Math.round(2 * R * Math.asin(Math.sqrt(h)) * 10) / 10;
        etaMin = Math.max(1, Math.round(distanceKm * 1.3 / 0.5));   // road ≈ 1.3× straight line, ~30 km/h in town
      }
      await aRef.set({ clientTrip: { distanceKm, etaMin, at: new Date().toISOString() } }, { merge: true });
      return NextResponse.json({ ok: true, sharing: true, distanceKm, etaMin });
    }

    // ── NO DOUBLE SUBMISSIONS, NO GOING BACKWARDS ─────────────────────────
    // The same status again within 3 minutes (or "running late" by a similar
    // amount) is recognised and not re-sent to the team; after "I'm here", a
    // stale "on my way" / "running late" is ignored.
    if (body.checkInStatus) {
      const st = String(body.checkInStatus), prev = String(appt.checkInStatus || '');
      const since = appt.clientStatusAt ? Date.now() - Date.parse(appt.clientStatusAt) : Infinity;
      const prevMins = Number(appt.lateTimeMinutes) || 0, mins = Math.max(0, Math.min(120, Math.round(Number(body.lateTimeMinutes) || 0)));
      const arrived = prev === 'arrived' || ['servicing', 'completed'].includes(String(appt.status || ''));
      if (arrived && st !== 'arrived') return NextResponse.json({ ok: true, ignored: 'already_here' });
      if (st === 'arrived' && ((await db.doc(`tenants/${tenantId}`).get()).data() as any)?.bookingPolicies?.onlineCheckIn === false)
        return NextResponse.json({ ok: false, error: 'Please check in at the front desk when you arrive.' }, { status: 403 });
      if (st === 'arrived' && prev === 'arrived') return NextResponse.json({ ok: true, duplicate: true });
      if (st === prev && since < 3 * 60000 && (st !== 'running_late' || Math.abs(mins - prevMins) < 5)) return NextResponse.json({ ok: true, duplicate: true });
    }

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
    if (clean.lateTimeMinutes !== undefined) clean.lateTimeMinutes = Math.max(0, Math.min(120, Math.round(Number(clean.lateTimeMinutes) || 0)));
    // A new "running late" replaces any earlier decision (the team decides again).
    // Who: from the appointment itself, never from the request.
    clean.appointmentId = apptId; clean.id = apptId;
    if (appt.clientId) clean.clientId = String(appt.clientId);
    if (appt.clientName) clean.clientName = String(appt.clientName);
    if (clean.checkInStatus === 'running_late') { clean.lateReply = null; clean.studioAskedToMove = false;
      if (appt?.startTime) clean.etaAt = new Date(Date.parse(appt.startTime) + (Number(clean.lateTimeMinutes) || 0) * 60000).toISOString(); }

    // Scoped write (the target state) + legacy mirror (compatibility).
    await db.doc(`tenants/${tenantId}/appointmentCheckIns/${token}`).set(publicVisitCopy(clean), { merge: true });

    // A RENTER'S client saying "on my way" / "running late" / "I'm here":
    // the studio's planner reads appointmentCheckIns, the renter's portal
    // reads the appointment. Mirror the status onto the appointment and drop
    // a line in the renter's inbox, so the renter hears it — it's their
    // chair the client is walking toward.
    if (clean.checkInStatus && clean.appointmentId) {
      try {
        const aRef = db.doc(`tenants/${tenantId}/appointments/${String(clean.appointmentId)}`);
        const a = (await aRef.get()).data() as any;
        if (a?.isRenterBooking) {
          const nowIso = new Date().toISOString();
          await aRef.set({ clientCheckInStatus: String(clean.checkInStatus), clientLateMinutes: Number(clean.lateTimeMinutes) || null, clientStatusAt: nowIso,
            ...(String(clean.checkInStatus) === 'arrived' && !['servicing', 'completed', 'cancelled'].includes(String(a.status || '')) ? { status: 'checked_in', checkedInAt: nowIso } : {}) }, { merge: true });
          const st = a.staffId ? ((await db.doc(`tenants/${tenantId}/staff/${String(a.staffId)}`).get()).data() as any) : null;
          if (st?.renterId) {
            const when = new Date(a.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
            const text = String(clean.checkInStatus) === 'arrived' ? `${a.clientName || 'Your client'} has arrived for their ${when} appointment.`
              : String(clean.checkInStatus) === 'running_late' ? `${a.clientName || 'Your client'} is running about ${Number(clean.lateTimeMinutes) || 10} minutes late for their ${when} appointment.`
              : `${a.clientName || 'Your client'} is on the way for their ${when} appointment.`;
            const { notifyRenter } = await import('@/lib/renter-comms');
            const kind = String(clean.checkInStatus) === 'running_late' ? 'running_late' : String(clean.checkInStatus) === 'arrived' ? 'arrived' : 'arrived';
            await notifyRenter(db, tenantId, String(st.renterId), kind as any, text, { tone: String(clean.checkInStatus) === 'running_late' ? 'amber' : 'green', subject: text });
          }
        }
      } catch (e) { console.error('[checkins] renter mirror', e); }
      // THE VISIT TICKET: arrival (or running late) goes on the visit's own timeline — every visit, not only renters'.
      try {
        const aRef2 = db.doc(`tenants/${tenantId}/appointments/${String(clean.appointmentId)}`); const a2: any = (await aRef2.get()).data();
        const cis = String(clean.checkInStatus); const nowIso2 = new Date().toISOString(); const tl: any[] = Array.isArray(a2?.timeline) ? a2.timeline : [];
        const via = String(clean.source || 'their link').replace(/_/g, ' ');
        const entry = cis === 'arrived' ? { at: nowIso2, kind: 'stage', stage: 'arrived', text: `Arrived — checked in (${via})`, by: a2?.clientName || 'Client', via: 'check-in' }
          : cis === 'running_late' ? { at: nowIso2, kind: 'change', text: `Running ~${Number(clean.lateTimeMinutes) || 10} min late`, by: a2?.clientName || 'Client', via: 'check-in', forClient: false } : null;
        const last = tl[tl.length - 1];
        if (a2 && entry && !(last && last.text === entry.text && Date.parse(nowIso2) - Date.parse(last.at) < 10 * 60000)) {
          await aRef2.set({ timeline: [...tl, entry].slice(-60), ...(cis === 'arrived' ? { arrivedAt: a2.arrivedAt || nowIso2 } : {}) }, { merge: true });
          const { publicTimeline, clientTimelineSettingsOf } = await import('@/lib/visit'); const tnt: any = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
          clean.timelinePublic = publicTimeline([...tl, entry], a2, tnt); clean.timelineShowTimes = clientTimelineSettingsOf(tnt).showTimes;   // what the business lets clients see
        }
      } catch (e) { console.error('[checkins] visit timeline', e); }
    }
    await db.doc(`appointmentCheckIns/${token}`).set(publicVisitCopy(clean), { merge: true }); // TODO: remove after legacy rule closes

    // What the client should know back — their grace period (Booking policies).
    let reply: any = {};
    if (clean.checkInStatus) {
      const aRef = db.doc(`tenants/${tenantId}/appointments/${String(body.appointmentId)}`);
      const t: any = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
      const P = resolvePolicy(t);
      const st = String(clean.checkInStatus); const mins = Number(clean.lateTimeMinutes) || 0;
      const grace = Number(P.late.graceMinutes.value) || 0;
      const nowIso = new Date().toISOString();
      const etaAt = st === 'running_late' && appt.startTime ? new Date(Date.parse(appt.startTime) + mins * 60000).toISOString() : null;
      // The fields the PLANNER and the DESK already show (checkInStatus / lateTimeMinutes):
      // what the client tells us from their link now appears everywhere, straight away.
      const done = ['completed', 'cancelled', 'no_show', 'servicing'].includes(String(appt.status || ''));
      if (!done) await aRef.set({
        checkInStatus: st, clientCheckInStatus: st, clientStatusAt: nowIso, checkInStatusTimestamp: nowIso,
        ...(st === 'running_late' ? { lateTimeMinutes: mins, clientLateMinutes: mins, clientEtaAt: etaAt, etaAt, clientLateNote: clean.lateNote || null, lateReply: null } : {}),
        ...(st === 'arrived' ? { clientTrip: null, ...arrivalFields(appt, 'client link', nowIso) } : {}),
      }, { merge: true });
      else if (st === 'arrived') await aRef.set({ clientTrip: null }, { merge: true });
      reply = { graceMinutes: grace, withinGrace: st !== 'running_late' || mins <= grace, lateFee: Number(P.late.fee.value) || 0 };
      // Tell the studio (renters are told above, in their own name).
      if (!appt.isRenterBooking && (st === 'running_late' || st === 'on_my_way' || st === 'arrived')) {
        const when = appt.startTime ? new Date(appt.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: t.timezone || undefined }) : '';
        const who = appt.clientName || 'Your client';
        const n = db.collection(`tenants/${tenantId}/notifications`).doc();
        await n.set({ id: n.id, userId: appt.staffId || null, read: false, createdAt: nowIso, type: st === 'running_late' ? 'running_late' : st === 'arrived' ? 'arrived' : 'on_my_way', link: 'pos', appointmentId: String(body.appointmentId),
          message: st === 'running_late' ? `Action needed: ${who} is running about ${mins} minutes late for their ${when} appointment${mins > grace ? `, which is past your ${grace}-minute grace period` : ''}.${clean.lateNote ? ` Their note: “${clean.lateNote}”.` : ''} Please decide what happens from the front desk or planner, and the client will be notified.`
            : st === 'arrived' ? `${who} has arrived for their ${when} appointment.` : `${who} is on the way for their ${when} appointment.` }).catch(() => {});
      }
      // Past the grace time → offer them their choices (Booking policies → "Offer late clients their choices").
      if (!done && !appt.isRenterBooking && st === 'running_late' && mins > grace) {
        const { lateChoicesModeOf } = await import('@/lib/late-choices');
        const mode = lateChoicesModeOf(t);
        if (mode !== 'off') {
          const { internalPost, internalOrigin } = await import('@/lib/message-policy');
          const lo = await internalPost(internalOrigin(t, req.nextUrl.origin), '/api/appointments/late-options', { tenantId, appointmentId: String(body.appointmentId), action: mode === 'send' ? 'send' : 'prepare' }, { retries: 0 });
          if (lo.ok && lo.data?.needed && lo.data?.status === 'sent') reply = { ...reply, choicesSent: true };
        }
      }
    }

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

    return NextResponse.json({ ok: true, ...reply });
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
    if (scoped.exists) return NextResponse.json({ ok: true, checkIn: publicVisitCopy(scoped.data()) });
    const legacy = await db.doc(`appointmentCheckIns/${token}`).get();
    const data = legacy.exists ? (legacy.data() as any) : null;
    if (data && data.tenantId !== tenantId) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
    return data
      ? NextResponse.json({ ok: true, checkIn: publicVisitCopy(data) })
      : NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
  } catch (err) {
    console.error('[checkins] GET failed', err);
    return NextResponse.json({ ok: false, error: 'Could not read check-in.' }, { status: 500 });
  }
}
