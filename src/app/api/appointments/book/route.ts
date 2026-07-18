// src/app/api/appointments/book/route.ts
//
// v11 — THE shared booking engine. Every booking surface (POS Quick Book,
// Add Appointment dialog, public booking page, client portal, walk-in
// kiosk) can call this ONE endpoint instead of each writing appointments
// with its own client-side conflict math.
//
// Why it exists — the failure it prevents: today each surface checks
// availability in the BROWSER, then writes. Two people booking the same
// slot from two surfaces (or two tabs) both pass their local check and
// both write — a silent double-booking. Here the overlap check and the
// write happen inside one Firestore transaction: the second writer is
// re-run against the first writer's appointment and told "just taken."
//
// POST {
//   tenantId, source,                     // source: 'public' | 'portal' | 'kiosk' | 'pos' | ...
//   serviceId, addOnIds?,
//   staffId,                              // a staff id, or 'any' (server resolves fairly)
//   startTime,                            // FULL ISO string incl. offset — the client
//                                         // computes it, so server timezone never matters
//   client: { id } | { name, email?, phone? },   // existing or new
//   notes?, holdOnly?,                    // holdOnly: create as 'pending_payment'
//   depositCents?, inspirationPhotoUrl?,
// }
// → { ok, appointmentId, checkInToken, shortCode, staffId, staffName,
//     startTime, endTime }
// → 409 with a human message when the slot was taken or nobody qualifies.
//
// Notes:
// - Padding (service.padBefore/padAfter) is enforced HERE, identically for
//   every surface — no more drift between each page's overlap math.
// - Check-in doc goes to the scoped path with a legacy mirror (same
//   migration pattern as /api/checkins).
// - 'any' resolution uses the SAME fairness field the POS surfaces use
//   (lastBookingAssignedAt), so all surfaces share one rotation queue.
// - holdOnly creates a 'pending_payment' appointment that HOLDS the slot;
//   the caller confirms after payment (or a cleanup pass releases stale
//   holds after 30 min — see PENDING_HOLD_MS).

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { logAuditAdmin } from '@/lib/audit';
import { generateShortCode } from '@/lib/short-code';
import { nanoid } from 'nanoid';

const PENDING_HOLD_MS = 30 * 60 * 1000;
const MAX_FIELD = 300;

const overlaps = (aS: number, aE: number, bS: number, bE: number) => aS < bE && bS < aE;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { tenantId, serviceId, startTime } = body || {};
    const source = String(body.source || 'api').slice(0, 40);
    if (!tenantId || !serviceId || !startTime) {
      return NextResponse.json({ ok: false, error: 'Missing parameters.' }, { status: 400 });
    }
    const start = new Date(startTime);
    if (Number.isNaN(start.getTime())) {
      return NextResponse.json({ ok: false, error: 'Invalid start time.' }, { status: 400 });
    }
    if (start.getTime() < Date.now() - 5 * 60 * 1000) {
      return NextResponse.json({ ok: false, error: 'That time is in the past.' }, { status: 400 });
    }

    const db = getAdminDb();

    // ── Service + duration (add-ons included) — server-authoritative ──
    const svcSnap = await db.doc(`tenants/${tenantId}/services/${serviceId}`).get();
    if (!svcSnap.exists) return NextResponse.json({ ok: false, error: 'Service not found.' }, { status: 404 });
    const svc = svcSnap.data() as any;
    const addOnIds: string[] = Array.isArray(body.addOnIds) ? body.addOnIds.slice(0, 10).map(String) : [];
    let addOnMinutes = 0;
    for (const id of addOnIds) {
      const a = await db.doc(`tenants/${tenantId}/services/${id}`).get();
      if (a.exists) addOnMinutes += Number((a.data() as any).duration) || 0;
    }
    const duration = (Number(svc.duration) || 60) + addOnMinutes;
    const padBefore = Number(svc.padBefore) || 0;
    const padAfter = Number(svc.padAfter) || 0;
    const end = new Date(start.getTime() + duration * 60000);

    // ── Staff roster (once, outside the transaction) ──
    const staffSnap = await db.collection(`tenants/${tenantId}/staff`).get();
    const roster = staffSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
    const certified: string[] | undefined = Array.isArray(svc.certifiedStaffIds) && svc.certifiedStaffIds.length > 0
      ? svc.certifiedStaffIds : undefined;
    const requestedStaffId = String(body.staffId || 'any');
    if (requestedStaffId !== 'any') {
      const member = roster.find((s: any) => s.id === requestedStaffId);
      if (!member) return NextResponse.json({ ok: false, error: 'Provider not found.' }, { status: 404 });
      if (certified && !certified.includes(requestedStaffId)) {
        return NextResponse.json({ ok: false, error: `${member.name || 'That provider'} isn't certified for this service.` }, { status: 409 });
      }
    }

    // ── The race-proof core: check + write in ONE transaction ──
    const dayStartIso = new Date(start.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const dayEndIso = new Date(end.getTime() + 24 * 60 * 60 * 1000).toISOString();
    const aptsRef = db.collection(`tenants/${tenantId}/appointments`);

    const result = await db.runTransaction(async (tx: any) => {
      const nearby = await tx.get(
        aptsRef.where('startTime', '>=', dayStartIso).where('startTime', '<=', dayEndIso),
      );
      const now = Date.now();
      const busyByStaff = new Map<string, { s: number; e: number }[]>();
      for (const d of nearby.docs) {
        const a = d.data() as any;
        if (!a.staffId || a.status === 'cancelled') continue;
        // stale unpaid holds don't block the chair
        if (a.status === 'pending_payment' && a.createdAt && now - new Date(a.createdAt).getTime() > PENDING_HOLD_MS) continue;
        const aS = new Date(a.startTime).getTime();
        const aE = new Date(a.endTime || a.startTime).getTime();
        if (Number.isNaN(aS) || Number.isNaN(aE)) continue;
        const aPadB = (Number(a.padBefore) || 0) * 60000;
        const aPadA = (Number(a.padAfter) || 0) * 60000;
        const list = busyByStaff.get(a.staffId) || [];
        list.push({ s: aS - aPadB, e: aE + aPadA });
        busyByStaff.set(a.staffId, list);
      }
      const windowS = start.getTime() - padBefore * 60000;
      const windowE = end.getTime() + padAfter * 60000;
      const isFree = (sid: string) =>
        !(busyByStaff.get(sid) || []).some((b) => overlaps(windowS, windowE, b.s, b.e));

      // Resolve the provider INSIDE the transaction so a concurrent booking
      // re-runs this resolution against fresh data.
      let staffId = requestedStaffId;
      if (staffId === 'any') {
        const pool = roster
          .filter((s: any) => s.active !== false)
          .filter((s: any) => !certified || certified.includes(s.id))
          .filter((s: any) => isFree(s.id))
          .sort((a: any, b: any) => {
            const aL = a.lastBookingAssignedAt ? new Date(a.lastBookingAssignedAt).getTime() : 0;
            const bL = b.lastBookingAssignedAt ? new Date(b.lastBookingAssignedAt).getTime() : 0;
            return aL - bL;
          });
        if (pool.length === 0) {
          return { conflict: 'No provider is free for that time — pick another slot.' };
        }
        staffId = pool[0].id;
      } else if (!isFree(staffId)) {
        const who = roster.find((s: any) => s.id === staffId)?.name?.split(' ')[0] || 'That provider';
        return { conflict: `${who} was just booked for that time — pick another slot.` };
      }

      // ── Client: existing id, or match-by-contact, or create ──
      let clientId = String(body?.client?.id || '');
      let clientName = '';
      if (clientId) {
        const c = await tx.get(db.doc(`tenants/${tenantId}/clients/${clientId}`));
        if (!c.exists) return { conflict: 'Client not found.' };
        clientName = (c.data() as any).name || '';
      } else {
        clientName = String(body?.client?.name || '').slice(0, MAX_FIELD).trim();
        if (!clientName) return { conflict: 'Client name is required.' };
        const newRef = db.collection(`tenants/${tenantId}/clients`).doc();
        clientId = newRef.id;
        tx.set(newRef, {
          id: clientId,
          name: clientName,
          email: String(body?.client?.email || '').slice(0, MAX_FIELD) || null,
          phone: String(body?.client?.phone || '').slice(0, 40) || null,
          status: 'active',
          lifetimeValue: 0,
          lastAppointment: new Date().toISOString(),
          createdVia: source,
        });
      }

      // ── Write the appointment + scoped check-in (legacy mirror) ──
      const aptId = nanoid();
      const token = nanoid(16);
      const shortCode = generateShortCode();
      const nowIso = new Date().toISOString();
      const payload: any = {
        id: aptId, tenantId,
        clientId, clientName,
        serviceId, addOnIds: addOnIds.length > 0 ? addOnIds : null,
        staffId,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        padBefore, padAfter,
        status: body.holdOnly ? 'pending_payment' : 'confirmed',
        source,
        checkInToken: token, shortCode,
        checkInStatus: 'pending',
        depositAmountCents: Number(body.depositCents) || 0,
        depositStatus: (Number(body.depositCents) || 0) > 0 ? 'pending' : 'none',
        notes: body.notes ? String(body.notes).slice(0, 500) : null,
        inspirationPhotoUrl: body.inspirationPhotoUrl ? String(body.inspirationPhotoUrl).slice(0, 500) : null,
        createdAt: nowIso,
        reminderSent: false,
        autoCancelledNoShow: false,
      };
      tx.set(aptsRef.doc(aptId), payload);
      tx.set(db.doc(`tenants/${tenantId}/appointmentCheckIns/${token}`), payload);
      tx.set(db.doc(`appointmentCheckIns/${token}`), payload); // TODO: remove after legacy rule closes
      if (requestedStaffId === 'any') {
        tx.set(db.doc(`tenants/${tenantId}/staff/${staffId}`), { lastBookingAssignedAt: nowIso }, { merge: true });
      }
      return { aptId, token, shortCode, staffId, clientId, clientName };
    });

    if ((result as any).conflict) {
      return NextResponse.json({ ok: false, error: (result as any).conflict }, { status: 409 });
    }
    const r: any = result;
    const staffName = roster.find((s: any) => s.id === r.staffId)?.name || null;

    await logAuditAdmin(db, tenantId, {
      action: 'appointment.booked',
      targetType: 'appointment', targetId: r.aptId,
      summary: `${r.clientName || 'Client'} booked ${svc.name || 'a service'} with ${staffName || 'staff'} — ${start.toISOString().slice(0, 16).replace('T', ' ')}${body.holdOnly ? ' (awaiting payment)' : ''}`,
      actor: { type: 'user', name: r.clientName || null, role: 'client', via: source },
    });

    return NextResponse.json({
      ok: true,
      appointmentId: r.aptId,
      checkInToken: r.token,
      shortCode: r.shortCode,
      staffId: r.staffId,
      staffName,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
    });
  } catch (err) {
    console.error('[appointments/book] failed', err);
    return NextResponse.json({ ok: false, error: 'Booking failed — nothing was saved. Try again.' }, { status: 500 });
  }
}
