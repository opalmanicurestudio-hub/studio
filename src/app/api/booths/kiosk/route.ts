/**
 * /api/booths/kiosk — v1 (self check-in kiosk)
 *
 * Public endpoint powering the front-desk tablet at /kiosk/[tenantId].
 * Admin SDK — anonymous guests can't write reservations through rules,
 * and lookups must never leak other guests' data. Responses carry the
 * minimum: first name, space, time window.
 *
 * POST { action: 'lookup',  tenantId, phoneLast4 }
 *   → today's confirmed bookings whose phone ends with those 4 digits.
 * POST { action: 'checkin', tenantId, reservationId, phoneLast4 }
 *   → re-verifies the match, stamps checked_in + actualCheckIn (the same
 *     fields the owner's Check In button writes — Operations updates
 *     live, the time clock runs, settlement works unchanged), plus a
 *     kiosk consent-reconfirmation timestamp. Notifies the owner.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

const digits = (s: any) => String(s || '').replace(/\D/g, '');

async function findAgreement(db: FirebaseFirestore.Firestore, tenantId: string): Promise<string> {
  // The booking page's application agreement lives in the page-builder
  // config. Try the plausible locations defensively; a miss is fine —
  // the kiosk falls back to reconfirmation language.
  const candidates = [
    `tenants/${tenantId}/settings/bookingPage`,
    `tenants/${tenantId}/bookingPageSettings/config`,
    `tenants/${tenantId}`,
  ];
  for (const path of candidates) {
    try {
      const snap = await db.doc(path).get();
      if (!snap.exists) continue;
      const data = snap.data() as any;
      const cfg = data?.cfPageConfig || data;
      const sections: any[] = Array.isArray(cfg?.sections) ? cfg.sections : [];
      for (const s of sections) {
        const txt = s?.config?.applicationAgreement;
        if (typeof txt === 'string' && txt.trim()) return txt.trim();
      }
    } catch { /* keep trying */ }
  }
  return '';
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, tenantId } = body || {};
    if (!tenantId || !action) {
      return NextResponse.json({ ok: false, error: 'Missing parameters.' }, { status: 400 });
    }
    const db = getAdminDb();
    const today = new Date().toISOString().slice(0, 10);

    if (action === 'lookup') {
      const last4 = digits(body.phoneLast4).slice(-4);
      if (last4.length !== 4) {
        return NextResponse.json({ ok: false, error: 'Enter the last 4 digits of your phone number.' }, { status: 400 });
      }
      const snap = await db.collection(`tenants/${tenantId}/boothReservations`)
        .where('startDate', '<=', today).get();
      const matches = snap.docs
        .map(d => ({ id: d.id, ...(d.data() as any) }))
        .filter(r =>
          ['confirmed', 'checked_in'].includes(r.status) &&
          r.endDate >= today &&
          digits(r.phone).slice(-4) === last4);
      if (matches.length === 0) {
        return NextResponse.json({ ok: false, error: "No booking found for today with that number. Double-check the digits, or see the front desk." });
      }
      const agreement = await findAgreement(db, tenantId);
      return NextResponse.json({
        ok: true,
        agreement,
        bookings: matches.map(r => ({
          id: r.id,
          firstName: (r.name || 'Guest').split(' ')[0],
          boothName: r.boothName || 'Space',
          startDate: r.startDate,
          endDate: r.endDate,
          bookingType: r.bookingType || 'daily',
          startTime: r.startTime || null,
          endTime: r.endTime || null,
          slotLabel: r.slotLabel || null,
          alreadyCheckedIn: r.status === 'checked_in',
        })),
      });
    }

    if (action === 'checkin') {
      const { reservationId } = body;
      const last4 = digits(body.phoneLast4).slice(-4);
      if (!reservationId || last4.length !== 4) {
        return NextResponse.json({ ok: false, error: 'Missing parameters.' }, { status: 400 });
      }
      const ref = db.doc(`tenants/${tenantId}/boothReservations/${reservationId}`);
      const snap = await ref.get();
      if (!snap.exists) return NextResponse.json({ ok: false, error: 'Booking not found.' }, { status: 404 });
      const r = snap.data() as any;
      if (digits(r.phone).slice(-4) !== last4) {
        return NextResponse.json({ ok: false, error: 'Booking not found.' }, { status: 404 });
      }
      if (r.status === 'checked_in') {
        return NextResponse.json({ ok: true, already: true, firstName: (r.name || 'Guest').split(' ')[0], boothName: r.boothName, endTime: r.endTime || null });
      }
      if (r.status !== 'confirmed' || r.startDate > today || r.endDate < today) {
        return NextResponse.json({ ok: false, error: 'This booking is not active today — see the front desk.' }, { status: 400 });
      }
      const nowIso = new Date().toISOString();
      await ref.set({
        status: 'checked_in',
        checked_inAt: nowIso,
        actualCheckIn: nowIso,
        kioskCheckIn: true,
        policiesReconfirmedAt: nowIso,
      }, { merge: true });
      const nRef = db.collection(`tenants/${tenantId}/notifications`).doc();
      await nRef.set({
        id: nRef.id, type: 'booth_reservation', read: false, createdAt: nowIso, link: '/booths',
        message: `👋 Kiosk check-in: ${r.name} — ${r.boothName}${r.bookingType === 'hourly' && r.endTime ? ` (until ${r.endTime})` : ''}`,
      });
      return NextResponse.json({ ok: true, firstName: (r.name || 'Guest').split(' ')[0], boothName: r.boothName, endTime: r.bookingType === 'hourly' ? r.endTime : null });
    }

    return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
  } catch (err) {
    console.error('[kiosk] failed', err);
    return NextResponse.json({ ok: false, error: 'Something went wrong — see the front desk.' }, { status: 500 });
  }
}
