// src/app/api/reservation/route.ts
//
// v18 — GUEST SELF-SERVE for day/hourly reservations — the engine behind
// the "Manage reservation" button in confirmation messages. Auth is the
// reservation's own manageToken (?k= in the guest's link), scoped to that
// one reservation. Mirrors /api/appt for appointments.
//
// POST { action, tenantId, resId, k }
//   'view'           → reservation details + studio info
//   'cancel-request' → flags the reservation cancel_requested and alerts
//                      the owner (money already moved through Stripe, so
//                      cancellations are owner-approved, never automatic)
// GET ?tenantId=&resId=&k= → calendar file (.ics) — all-day event(s) for
//   daily bookings, exact window for hourly ones.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { logAuditAdmin } from '@/lib/audit';
import { reservationWhenLabel } from '@/lib/reservation-notify';

async function loadAuthed(db: any, tenantId: string, resId: string, k: any) {
  if (!tenantId || !resId || !k || String(k).length < 16) return null;
  const ref = db.doc(`tenants/${tenantId}/boothReservations/${resId}`);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const r = snap.data() as any;
  if (!r.manageToken || r.manageToken !== String(k)) return null;
  return { ref, r };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, tenantId, resId } = body || {};
    if (!action || !tenantId || !resId) return NextResponse.json({ ok: false, error: 'Missing parameters.' }, { status: 400 });
    const db = getAdminDb();
    const authed = await loadAuthed(db, tenantId, resId, body.k);
    if (!authed) return NextResponse.json({ ok: false, error: 'This link is no longer valid — call the studio and we\'ll help.' }, { status: 401 });
    const { ref, r } = authed;

    const tData = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
    const studioName = tData.name || tData.businessName || 'The studio';

    if (action === 'view') {
      return NextResponse.json({
        ok: true, studioName,
        reservation: {
          boothName: r.boothName || 'Space',
          whenLabel: reservationWhenLabel(r),
          startDate: r.startDate, endDate: r.endDate,
          bookingType: r.bookingType || 'daily',
          startTime: r.startTime || null, endTime: r.endTime || null,
          status: r.status,
          paidCents: Number(r.amountCents) || 0,
          paidWithPass: !!r.paidWithPassId,
          balanceDueCents: (!r.balancePaid && Number(r.balanceDueCents) > 0) ? Number(r.balanceDueCents) : 0,
          balanceMode: r.balanceMode || null,
          cancelRequested: r.status === 'cancel_requested' || !!r.cancelRequestedAt,
        },
      });
    }

    if (action === 'cancel-request') {
      if (['completed', 'cancelled', 'refunded'].includes(String(r.status || ''))) {
        return NextResponse.json({ ok: false, error: 'This reservation is already finished.' }, { status: 409 });
      }
      if (r.status === 'cancel_requested' || r.cancelRequestedAt) {
        return NextResponse.json({ ok: true, already: true });
      }
      const nowIso = new Date().toISOString();
      await ref.set({
        status: 'cancel_requested', cancelRequestedAt: nowIso,
        cancelRequestNote: String(body.note || '').slice(0, 300) || null,
      }, { merge: true });
      try {
        const nRef = db.collection(`tenants/${tenantId}/notifications`).doc();
        await nRef.set({
          id: nRef.id, type: 'booth_reservation', read: false, createdAt: nowIso, link: '/pos?tab=spaces',
          message: `Cancellation requested: ${r.name || 'A guest'} — ${r.boothName || 'space'}, ${reservationWhenLabel(r)}. Approve/refund from Booth Hub.`,
        });
      } catch { /* bell is a bonus */ }
      await logAuditAdmin(db, tenantId, {
        action: 'booth.cancel_requested', targetType: 'boothReservation', targetId: resId,
        summary: `${r.name || 'Guest'} requested cancellation — ${r.boothName || 'space'} (${reservationWhenLabel(r)})`,
        actor: { type: 'user', name: r.name || 'Guest', role: 'guest', via: 'manage-link' },
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
  } catch (err) {
    console.error('[reservation] failed', err);
    return NextResponse.json({ ok: false, error: 'Something went wrong — try again.' }, { status: 500 });
  }
}

// ── Add to calendar (.ics) ────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const tenantId = url.searchParams.get('tenantId') || '';
    const resId = url.searchParams.get('resId') || '';
    const k = url.searchParams.get('k') || '';
    const db = getAdminDb();
    const authed = await loadAuthed(db, tenantId, resId, k);
    if (!authed) return new NextResponse('Link expired', { status: 401 });
    const { r } = authed;
    const tData = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
    const studioName = tData.name || 'Studio';

    const clean = (s: string) => s.replace(/[\n,;]/g, ' ');
    let dtLines: string[];
    if (r.bookingType === 'hourly' && r.startTime && r.endTime) {
      // Floating local times — lands at wall-clock time wherever the guest is.
      const d = String(r.startDate).replace(/-/g, '');
      dtLines = [
        `DTSTART:${d}T${String(r.startTime).replace(':', '')}00`,
        `DTEND:${d}T${String(r.endTime).replace(':', '')}00`,
      ];
    } else {
      // All-day event(s): DTEND is exclusive, so end date + 1 day.
      const endPlus = new Date(new Date(r.endDate + 'T00:00:00Z').getTime() + 86400000)
        .toISOString().slice(0, 10).replace(/-/g, '');
      dtLines = [
        `DTSTART;VALUE=DATE:${String(r.startDate).replace(/-/g, '')}`,
        `DTEND;VALUE=DATE:${endPlus}`,
      ];
    }
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ClarityFlow//EN', 'BEGIN:VEVENT',
      `UID:${resId}@clarityflow`,
      ...dtLines,
      `SUMMARY:${clean(`${r.boothName || 'Space'} — ${studioName}`)}`,
      `DESCRIPTION:${clean(`${studioName} · booked by ${r.name || 'guest'}`)}`,
      'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    return new NextResponse(ics, {
      headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="reservation.ics"' },
    });
  } catch { return new NextResponse('Error', { status: 500 }); }
}
