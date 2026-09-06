/**
 * /api/booths/reserve — v1 (SPRINT 3: pay-and-book for day rentals)
 *
 * POST — creates a conflict-checked reservation and a Stripe Checkout
 *        session. The visitor pays on Stripe's hosted page and returns.
 * GET  — confirms payment (idempotent): verifies the Checkout session is
 *        paid, flips the reservation to 'confirmed', notifies the owner.
 *
 * Design decisions:
 *  - Admin SDK (getAdminDb) — reservations carry PII, so they are NEVER
 *    publicly readable; all checks happen server-side. No rules changes.
 *  - Conflict engine: a booth-day can be sold once. Confirmed
 *    reservations always block; pending ones block for 30 minutes (a
 *    checkout in progress holds the dates, then expires — no deadlocks
 *    from abandoned carts).
 *  - The Stripe race window (two checkouts completing for the same dates)
 *    is closed at confirm time: if the dates got taken while paying, the
 *    reservation is NOT confirmed and the response tells the client to
 *    contact the studio for a refund — flagged in the owner notification.
 *    Rare by construction (30-min holds), handled honestly when it happens.
 *
 * ENV: STRIPE_SECRET_KEY (already set — charge-card uses it).
 */

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getAdminDb } from '@/lib/firebase-admin';
import { logAuditAdmin } from '@/lib/audit';
import { resolveIncidentalPolicy, validateIncidental } from '@/lib/incidentals';
import { resolveDayUseAgreement, buildSignedRecord } from '@/lib/esign';
import { recognizeContact, resolveRenterDayDiscount } from '@/lib/booth-recognition';
import { sendReservationConfirmation } from '@/lib/reservation-notify';
import { tenantTimeZone, todayIn } from '@/lib/tenant-time';
import { subletOpenOn } from '@/lib/leave-policy';

// The owner's custom booking terms, if they wrote any, from the booking-page
// config. A miss is fine — resolveDayUseAgreement falls back to the built-in
// protective default, so a guest always signs real terms.
function findBookingTerms(tenantData: any): string {
  try {
    const roots = [tenantData?.cfPageConfig, tenantData?.bookingPageSettings, tenantData];
    for (const cfg of roots) {
      if (!cfg) continue;
      if (typeof cfg.applicationAgreement === 'string' && cfg.applicationAgreement.trim()) return cfg.applicationAgreement.trim();
      const sections: any[] = Array.isArray(cfg.sections) ? cfg.sections : [];
      for (const s of sections) {
        const txt = s?.config?.applicationAgreement;
        if (typeof txt === 'string' && txt.trim()) return txt.trim();
      }
    }
  } catch { /* fall back to default template */ }
  return '';
}

// The incidentals caps the guest is authorizing, rendered for the agreement.
function incidentalScheduleText(cats: { label: string; capCents: number }[]): string {
  if (!Array.isArray(cats) || cats.length === 0) return '(No incidental charges configured.)';
  return cats.map((c) => c.capCents > 0 ? `• ${c.label} — up to $${(c.capCents / 100).toFixed(0)}` : `• ${c.label}`).join('\n');
}

// Persist the signed day-use agreement to the append-only, write-once legal
// store — the SAME collection leases and staff agreements use. Idempotent:
// one signed record per reservation, keyed by meta.reservationId.
async function persistDayUseSignature(db: FirebaseFirestore.Firestore, tenantId: string, reservationId: string, r: any): Promise<void> {
  try {
    if (!r?.agreementSignedName || !r?.agreementText) return;
    const col = db.collection(`tenants/${tenantId}/signedDocuments`);
    const existing = await col.where('meta.reservationId', '==', reservationId).limit(1).get();
    if (!existing.empty) return;
    const ref = col.doc();
    const record = buildSignedRecord(ref.id, {
      subjectType: 'client',
      subjectId: reservationId,
      subjectName: r.name || 'Guest',
      kind: 'day_use',
      title: r.agreementTitle || 'Short-Term Rental Agreement',
      agreementText: r.agreementText,
      meta: {
        reservationId, source: 'online_booking',
        boothId: r.boothId || null, boothName: r.boothName || null,
        startDate: r.startDate || null, endDate: r.endDate || null,
        bookingType: r.bookingType || null,
      },
    }, r.agreementSignedName);
    // The guest actually signed at booking time — keep that timestamp on the
    // legal record rather than the (later) confirmation time.
    await ref.set({ ...record, signedAt: r.agreementSignedAt || record.signedAt });
  } catch (err) {
    // A signed-doc write must never break payment confirmation; the snapshot
    // also lives on the reservation itself as a backstop.
    console.error('[booth-reserve] persistDayUseSignature failed', err);
  }
}

const LEASE_FREQS = ['monthly', 'weekly', 'biweekly'];
const DAY_MS = 24 * 60 * 60 * 1000;
const PENDING_HOLD_MS = 30 * 60 * 1000;

function daysInclusive(start: string, end: string): number {
  const s = new Date(start + 'T00:00:00Z').getTime();
  const e = new Date(end + 'T00:00:00Z').getTime();
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return 0;
  return Math.round((e - s) / DAY_MS) + 1;
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

// v67 — TIME-AWARE conflicts. Two reservations conflict when their date
// ranges overlap AND their times overlap. A daily booking (no times)
// occupies the whole day, so it conflicts with everything that day.
// Hourly bookings only conflict when their hour windows intersect.

// ─── Day rental → bookable availability ──────────────────────────────────────
// A confirmed day rental gives someone a chair. Until now it did NOT make them
// bookable, so a renter could pay for a station and stay invisible in the
// booking system — a paid-for chair nobody could book into.
//
// The grant writes the SAME date override an accepted swap writes
// (staff.availability.dates['yyyy-MM-dd']), because "this person is bookable
// here on this date" is one idea, not several competing ones.
//
// Three things it will not do:
//   · touch anyone without a renterId — walk-in guests have no provider record;
//   · touch a renter who runs their own booking system;
//   · overwrite a SWAP override, ever. Two renters already agreed that day
//     between themselves, and quietly moving it would be the system taking a
//     side in someone else's arrangement.
const DAY_NAMES_RES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function eachDate(startDate: string, endDate: string, cap = 31): string[] {
  const out: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return out;
  const last = /^\d{4}-\d{2}-\d{2}$/.test(endDate) ? endDate : startDate;
  const d = new Date(`${startDate}T12:00:00Z`);
  while (out.length < cap) {
    const key = d.toISOString().slice(0, 10);
    out.push(key);
    if (key >= last) break;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

async function syncReservationAvailability(
  db: FirebaseFirestore.Firestore,
  tenantId: string,
  reservationId: string,
  r: any,
  grant: boolean,
): Promise<{ granted: number; skipped: string[] }> {
  const skipped: string[] = [];
  try {
    if (!r?.renterId) return { granted: 0, skipped: ['no renter record'] };
    const staffSnap = await db.collection(`tenants/${tenantId}/staff`)
      .where('renterId', '==', r.renterId).limit(5).get();
    const staffDoc = staffSnap.docs.find((d) => (d.data() as any)?.isRenter);
    if (!staffDoc) return { granted: 0, skipped: ['not a booking provider'] };
    const sd = staffDoc.data() as any;
    if (sd.bookingOptOut === true) return { granted: 0, skipped: ['books elsewhere'] };

    // Hourly rentals carry their own window. A DAILY rental does not, and a
    // date override without hours would fall through to the weekly template —
    // which for a renter is clamped to their lease and may well say "off".
    // So daily rentals borrow the studio's own hours for that weekday rather
    // than inventing a window nobody agreed to.
    const isHourly = r.bookingType === 'hourly' && r.startTime && r.endTime;
    let profileWeek: any = null;
    if (!isHourly && grant) {
      try {
        const tSnap = await db.doc(`tenants/${tenantId}`).get();
        const profiles = (tSnap.data() as any)?.scheduleProfiles;
        profileWeek = Array.isArray(profiles) ? (profiles.find((x: any) => x.isActive)?.week || null) : null;
      } catch { /* fall through to skipping daily grants */ }
    }

    const existingDates = (sd?.availability?.dates && typeof sd.availability.dates === 'object')
      ? sd.availability.dates : {};
    const patch: Record<string, any> = {};
    let granted = 0;

    for (const dk of eachDate(String(r.startDate || ''), String(r.endDate || ''))) {
      const existing = existingDates[dk];
      if (existing && existing.reason === 'swap') { skipped.push(`${dk}: a swap already owns that day`); continue; }
      if (!grant) {
        // Only ever remove our own.
        if (!existing || existing.reason === 'day_rental') patch[dk] = FieldValueDelete();
        continue;
      }
      let start = isHourly ? String(r.startTime) : '';
      let end = isHourly ? String(r.endTime) : '';
      if (!isHourly) {
        const row = profileWeek?.[DAY_NAMES_RES[new Date(`${dk}T12:00:00Z`).getUTCDay()]];
        if (!row?.enabled || !row?.start || !row?.end) { skipped.push(`${dk}: studio has no hours set`); continue; }
        start = String(row.start); end = String(row.end);
      }
      patch[dk] = {
        enabled: true, start, end,
        reason: 'day_rental', reservationId,
        setAt: new Date().toISOString(),
      };
      granted++;
    }

    if (Object.keys(patch).length > 0) {
      const flat: Record<string, any> = {};
      for (const [k, v] of Object.entries(patch)) flat[`availability.dates.${k}`] = v;
      await staffDoc.ref.update(flat);
    }
    return { granted, skipped };
  } catch (err) {
    // Availability is a bonus on top of a paid reservation. It must never be
    // able to fail a payment confirmation; the nightly sweep reconciles it.
    console.error('[booth-reserve] syncReservationAvailability failed', err);
    return { granted: 0, skipped: ['sync failed'] };
  }
}

/** Admin SDK sentinel, imported lazily so the module stays edge-safe. */
function FieldValueDelete(): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { FieldValue } = require('firebase-admin/firestore');
  return FieldValue.delete();
}

function timesConflict(a: any, b: any): boolean {
  const aHourly = a.bookingType === 'hourly' && a.startTime && a.endTime;
  const bHourly = b.bookingType === 'hourly' && b.startTime && b.endTime;
  if (!aHourly || !bHourly) return true;           // any daily involved → whole-day block
  return a.startTime < b.endTime && b.startTime < a.endTime;
}

async function findConflict(db: FirebaseFirestore.Firestore, tenantId: string, boothId: string, proposed: { startDate: string; endDate: string; bookingType?: string; startTime?: string; endTime?: string }, ignoreId?: string) {
  const snap = await db.collection(`tenants/${tenantId}/boothReservations`).where('boothId', '==', boothId).get();
  const now = Date.now();
  for (const d of snap.docs) {
    const r = d.data() as any;
    if (ignoreId && d.id === ignoreId) continue;
    const holds = r.status === 'confirmed' ||
      (r.status === 'pending_payment' && r.createdAt && now - new Date(r.createdAt).getTime() < PENDING_HOLD_MS);
    if (holds && overlaps(proposed.startDate, proposed.endDate, r.startDate, r.endDate) && timesConflict(proposed, r)) return true;
  }
  return false;
}

// v85 — shared-lease occupancy. A 'partial' booth is bookable, but never
// inside a window a resident renter's lease already owns (scheduleSlot:
// weekday indexes + optional HH:MM window; no times = whole day).
async function leaseSlotConflict(db: FirebaseFirestore.Firestore, tenantId: string, boothId: string, proposed: { startDate: string; endDate: string; bookingType?: string; startTime?: string; endTime?: string }): Promise<string | null> {
  const snap = await db.collection(`tenants/${tenantId}/leases`).where('boothId', '==', boothId).get();
  const held = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as any) }))
    .filter((l) => ['active', 'on_leave', 'pending_signature'].includes(l.status)
      && l.scheduleSlot && Array.isArray(l.scheduleSlot.days) && l.scheduleSlot.days.length > 0);
  if (!held.length) return null;
  // A renter on SUBLET leave has handed their days back for a fixed window.
  // The window lives on the booth as two dates, and it is re-read here per
  // day rather than trusted as a flag: the moment the window ends the chair
  // is theirs again, even if nothing ran overnight to say so.
  const bSnap = await db.doc(`tenants/${tenantId}/booths/${boothId}`).get();
  const booth: any = bSnap.data() || {};
  const isHourly = proposed.bookingType === 'hourly' && proposed.startTime && proposed.endTime;
  for (let t = new Date(proposed.startDate + 'T00:00:00Z').getTime(), e = new Date(proposed.endDate + 'T00:00:00Z').getTime(); t <= e; t += DAY_MS) {
    const iso = new Date(t).toISOString().slice(0, 10);
    const dow = new Date(t).getUTCDay();
    for (const l of held) {
      if (subletOpenOn(booth, iso) && booth.subletLeaseId === l.id) continue;
      const s = l.scheduleSlot;
      if (!s.days.includes(dow)) continue;
      const slotStart = s.startTime || '00:00';
      const slotEnd = s.endTime || '23:59';
      if (!isHourly) return `${iso} (a resident renter has that day)`;
      if ((proposed.startTime as string) < slotEnd && slotStart < (proposed.endTime as string)) {
        return `${iso} ${slotStart}–${slotEnd} (a resident renter has that window)`;
      }
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // ── DESK AVAILABILITY ─────────────────────────────────────────────
    // What the front desk can sell today, for one date.
    //
    // Deliberately built on findConflict() and leaseSlotConflict() — the SAME
    // functions the public booking path uses. A second implementation would
    // drift the first time a rule changed, and then the desk's answer and the
    // customer's screen would disagree about the same chair. Reusing them is
    // the whole point of putting this action in this file.
    //
    // Unpaid holds are returned rather than hidden: someone mid-checkout on
    // the public page has a real claim for PENDING_HOLD_MS, and a desk that
    // cannot see it will confidently sell the chair out from under them.
    if (body?.action === 'desk-availability') {
      const { tenantId: tid, date } = body || {};
      if (!tid || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
        return NextResponse.json({ ok: false, error: 'Missing tenant or date.' }, { status: 400 });
      }
      const db = getAdminDb();
      const boothSnap = await db.collection(`tenants/${tid}/booths`).get();
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
      const now = Date.now();

      const out: any[] = [];
      for (const bd of boothSnap.docs) {
        const b: any = { id: bd.id, ...(bd.data() as any) };
        if (b.isActive === false) continue;
        const options: any[] = Array.isArray(b.pricingOptions) ? b.pricingOptions : [];
        const hourRate = options.find((o) => o.frequency === 'hourly' && o.amountCents > 0) || null;
        const dayRate = options.find((o) => o.frequency === 'daily' && o.amountCents > 0) || null;
        // Nothing sellable here — leave it out entirely rather than showing a
        // space the desk would only be disappointed by.
        const subletOpen = subletOpenOn(b, date);
        if ((!b.dayUseEnabled && !subletOpen) || (!hourRate && !dayRate)) continue;

        // Out of service is DIFFERENT from not-listed: the desk needs to see
        // it and know why, or they will quote a chair the planner shows as
        // dead. Maintenance sets booth.status itself (syncBooth), so this is
        // the same truth every other surface reads — not a second opinion.
        const outOfService = b.status === 'maintenance';

        const schedDays: number[] | null = Array.isArray(b.availableDays) && b.availableDays.length > 0
          ? b.availableDays.map(Number) : null;
        const blackouts: string[] = Array.isArray(b.blackoutDates) ? b.blackoutDates : [];
        const closedToday = (schedDays && !schedDays.includes(dow)) || blackouts.includes(date);

        // Everything occupying this booth on this date, with WHY.
        const busy: any[] = [];
        const rSnap = await db.collection(`tenants/${tid}/boothReservations`).where('boothId', '==', bd.id).get();
        for (const rd of rSnap.docs) {
          const r: any = rd.data() || {};
          const held = r.status === 'confirmed' || r.status === 'checked_in'
            || (r.status === 'pending_payment' && r.createdAt && now - new Date(r.createdAt).getTime() < PENDING_HOLD_MS);
          if (!held) continue;
          if (!overlaps(date, date, r.startDate, r.endDate || r.startDate)) continue;
          const isH = r.bookingType === 'hourly' && r.startTime && r.endTime;
          busy.push({
            start: isH ? r.startTime : (b.openTime || '00:00'),
            end: isH ? r.endTime : (b.closeTime || '23:59'),
            kind: r.status === 'pending_payment' ? 'hold' : 'booked',
            who: r.name || 'Guest',
            wholeDay: !isH,
            expiresInMin: r.status === 'pending_payment'
              ? Math.max(0, Math.round((PENDING_HOLD_MS - (now - new Date(r.createdAt).getTime())) / 60000)) : null,
          });
        }
        const lSnap = await db.collection(`tenants/${tid}/leases`).where('boothId', '==', bd.id).get();
        for (const ld of lSnap.docs) {
          const l: any = ld.data() || {};
          if (!['active', 'on_leave', 'pending_signature'].includes(String(l.status))) continue;
          if (subletOpen && b.subletLeaseId === ld.id) continue;
          const slot = l.scheduleSlot;
          if (!slot || !Array.isArray(slot.days) || !slot.days.includes(dow)) continue;
          busy.push({
            start: slot.startTime || (b.openTime || '00:00'),
            end: slot.endTime || (b.closeTime || '23:59'),
            kind: 'lease', who: 'Resident renter',
            wholeDay: !slot.startTime || !slot.endTime, expiresInMin: null,
          });
        }

        const dayTaken = closedToday || busy.length > 0 || outOfService;
        out.push({
          id: bd.id, name: b.name || 'Space',
          outOfService,
          maintenanceNote: outOfService ? (b.maintenanceNote || 'Out of service') : null,
          openTime: b.openTime || '09:00', closeTime: b.closeTime || '19:00',
          hourlyCents: hourRate?.amountCents ?? null,
          dailyCents: dayRate?.amountCents ?? null,
          minHours: Number(b.dayUseMinHours) || 1,
          closedToday, dayTaken, busy,
        });
      }
      out.sort((a, b2) => String(a.name).localeCompare(String(b2.name)));
      return NextResponse.json({ ok: true, date, booths: out, holdMinutes: Math.round(PENDING_HOLD_MS / 60000) });
    }

    // ── DESK BOOKING ──────────────────────────────────────────────────
    // The front desk taking a booking for someone standing there. Same
    // conflict checks, same collection, same availability grant as a paid
    // public booking — the only difference is that money is settled at the
    // till instead of through Stripe, so paymentStatus is recorded honestly
    // rather than a Stripe id being invented.
    if (body?.action === 'desk-book') {
      const { tenantId: tid, boothId, date, bookingType, startTime, endTime,
        name, phone, email, paid, staffId, staffName } = body || {};
      if (!tid || !boothId || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) || !String(name || '').trim()) {
        return NextResponse.json({ ok: false, error: 'Need a space, a date and a name.' }, { status: 400 });
      }
      const isHourly = bookingType === 'hourly';
      if (isHourly && !(/^([01]\d|2[0-3]):[0-5]\d$/.test(String(startTime)) && /^([01]\d|2[0-3]):[0-5]\d$/.test(String(endTime)) && startTime < endTime)) {
        return NextResponse.json({ ok: false, error: 'Give a start and end time that run forwards.' }, { status: 400 });
      }
      const db = getAdminDb();
      const bSnap = await db.doc(`tenants/${tid}/booths/${boothId}`).get();
      if (!bSnap.exists) return NextResponse.json({ ok: false, error: 'That space is gone.' }, { status: 404 });
      const booth: any = bSnap.data();
      if (!booth.dayUseEnabled && !subletOpenOn(booth, date)) {
        return NextResponse.json({ ok: false, error: 'That space is not set up for day use.' }, { status: 400 });
      }
      // The one place the desk could sell a chair maintenance has taken down.
      // The public checkout already refuses anything not vacant/partial; the
      // desk path was written later and skipped it — which meant the planner
      // could show a station as dead while the counter took money for it.
      if (booth.status === 'maintenance') {
        return NextResponse.json({
          ok: false,
          error: `${booth.name || 'That space'} is out of service${booth.maintenanceNote ? ` — ${booth.maintenanceNote}` : ''}. Resolve the ticket before booking it.`,
        }, { status: 409 });
      }

      // Server-side pricing, always. Reads the same pricingOptions the public
      // path reads; the desk never dictates an amount.
      const options: any[] = Array.isArray(booth.pricingOptions) ? booth.pricingOptions : [];
      let amountCents = 0; let unitsLabel = '';
      if (isHourly) {
        const hourRate = options.find((o) => o.frequency === 'hourly' && o.amountCents > 0);
        if (!hourRate) return NextResponse.json({ ok: false, error: 'No hourly rate is set for that space.' }, { status: 400 });
        const hrs = Math.round((((new Date(`2000-01-01T${endTime}:00Z`).getTime() - new Date(`2000-01-01T${startTime}:00Z`).getTime()) / 3600000)) * 2) / 2;
        if (hrs < 1 || hrs > 14) return NextResponse.json({ ok: false, error: 'Hourly bookings run 1–14 hours.' }, { status: 400 });
        amountCents = Math.round(hourRate.amountCents * hrs);
        unitsLabel = `${hrs} hour${hrs === 1 ? '' : 's'} (${startTime}–${endTime})`;
      } else {
        const dayRate = options.find((o) => o.frequency === 'daily' && o.amountCents > 0);
        if (!dayRate) return NextResponse.json({ ok: false, error: 'No daily rate is set for that space.' }, { status: 400 });
        amountCents = dayRate.amountCents;
        unitsLabel = '1 day';
      }

      const proposed = { startDate: date, endDate: date, bookingType: isHourly ? 'hourly' : 'daily', startTime, endTime };
      if (await findConflict(db, tid, boothId, proposed)) {
        return NextResponse.json({ ok: false, error: 'That space was just taken for part of that window.' }, { status: 409 });
      }
      const leaseClash = await leaseSlotConflict(db, tid, boothId, proposed);
      if (leaseClash) return NextResponse.json({ ok: false, error: `Not available — ${leaseClash}.` }, { status: 409 });

      const recognition = await recognizeContact(db, tid, phone || null, email || null).catch(() => null);
      const nowIso = new Date().toISOString();
      const ref = db.collection(`tenants/${tid}/boothReservations`).doc();
      const subletOn = subletOpenOn(booth, date);
      const resData: any = {
        id: ref.id, tenantId: tid, boothId, boothName: booth.name || 'Space',
        subletLeaseId: subletOn ? (booth.subletLeaseId || null) : null,
        subletRenterId: subletOn ? (booth.subletRenterId || null) : null,
        startDate: date, endDate: date,
        bookingType: isHourly ? 'hourly' : 'daily',
        startTime: isHourly ? startTime : null,
        endTime: isHourly ? endTime : null,
        name: String(name).trim().slice(0, 120),
        phone: String(phone || '').slice(0, 40), email: String(email || '').slice(0, 160),
        amountCents, unitsLabel,
        status: 'confirmed', createdAt: nowIso, confirmedAt: nowIso,
        paymentStatus: paid ? 'paid' : 'unpaid',
        source: 'desk', bookedByStaffId: staffId || null, bookedByStaffName: staffName || null,
        stripeSessionId: null, stripePaymentIntentId: null,
        renterId: recognition?.renterId || null,
        guestTier: recognition?.tier || 'new',
      };
      await ref.set(resData);
      const availability = await syncReservationAvailability(db, tid, ref.id, resData, true);
      // A booking taken at the desk deserves the same confirmation a booking
      // taken online gets. Without this the guest walked away with nothing —
      // no times, no address, no manage link — purely because of which side of
      // the counter the booking happened to be entered from.
      await sendReservationConfirmation(db, tid, ref.id, resData, {
        originFallback: String(body.origin || '').split('?')[0] || undefined,
      }).catch(() => { /* the booking stands whether or not the email lands */ });

      const nRef = db.collection(`tenants/${tid}/notifications`).doc();
      await nRef.set({ id: nRef.id, type: 'booth_reservation', read: false, createdAt: nowIso, link: '/pos?tab=spaces',
        message: `Desk booking: ${resData.name} — ${resData.boothName}, ${date} · ${unitsLabel} ($${(amountCents / 100).toFixed(2)}${paid ? '' : ' — unpaid'})` });
      await logAuditAdmin(db, tid, {
        action: 'booth.desk_booked', targetType: 'boothReservation', targetId: ref.id,
        summary: `${staffName || 'The desk'} booked ${resData.boothName} for ${resData.name} on ${date} (${unitsLabel}, ${paid ? 'paid' : 'unpaid'})`,
        actor: { type: 'user', name: staffName || 'Front desk', via: 'pos-desk-panel' },
      });
      return NextResponse.json({
        ok: true, reservationId: ref.id, amountCents, unitsLabel,
        boothName: resData.boothName, bookable: availability.granted > 0,
      });
    }

    // ── BUY A DAY PASS (public booking page) ─────────────────────────
    // Server-side pricing only: the client sends a pack INDEX; days and
    // price come from the owner's config. Payment via Stripe Checkout;
    // the pass is created on confirmed payment (GET below), never before.
    if (body?.action === 'buy-pass') {
      const { tenantId: tid, packIndex, name: pname, phone: pphone, email: pemail, returnUrl: prurl } = body || {};
      if (!tid || !pname || (!pphone && !pemail) || !prurl) {
        return NextResponse.json({ ok: false, error: 'Missing required fields.' }, { status: 400 });
      }
      if (!process.env.STRIPE_SECRET_KEY) {
        return NextResponse.json({ ok: false, error: 'Payments are not configured yet.' }, { status: 500 });
      }
      const dbp = getAdminDb();
      const tSnap = await dbp.doc(`tenants/${tid}`).get();
      const raw = (tSnap.data() as any)?.bookingPageSettings?.dayPassPacks;
      const packs = Array.isArray(raw) ? raw.filter((p: any) => Number(p.days) > 0 && Number(p.amountCents) > 0) : [];
      const pack = packs[Number(packIndex)];
      if (!pack) return NextResponse.json({ ok: false, error: 'That pack is no longer offered — refresh and try again.' }, { status: 400 });
      const nowIso = new Date().toISOString();
      const purRef = dbp.collection(`tenants/${tid}/boothPassPurchases`).doc();
      await purRef.set({
        id: purRef.id, tenantId: tid, status: 'pending_payment', createdAt: nowIso,
        name: String(pname).slice(0, 120), phone: String(pphone || '').slice(0, 40), email: String(pemail || '').slice(0, 160),
        packLabel: pack.label || `${pack.days}-day pack`, days: Number(pack.days), amountCents: Number(pack.amountCents),
      });
      const stripePass = new Stripe(process.env.STRIPE_SECRET_KEY as string);
      const base = String(prurl).split('?')[0];
      const session = await stripePass.checkout.sessions.create({
        mode: 'payment',
        customer_email: pemail || undefined,
        line_items: [{
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: Number(pack.amountCents),
            product_data: {
              name: `${pack.label || `${pack.days}-day pack`} — ${pack.days} day pass`,
              description: 'Prepaid studio days — bookings redeem automatically, no charge at checkout.',
            },
          },
        }],
        success_url: `${base}?cfPassPurchase=${purRef.id}&cfSession={CHECKOUT_SESSION_ID}`,
        cancel_url: base,
        metadata: { tenantId: tid, passPurchaseId: purRef.id, kind: 'day_pass' },
      });
      await purRef.set({ stripeSessionId: session.id }, { merge: true });
      return NextResponse.json({ ok: true, url: session.url });
    }

    const { tenantId, boothId, startDate, endDate, name, phone, email, returnUrl, consentAccepted, bookingType, startTime, endTime, slotLabel,
      doingServices, licenseNumber, insuranceCarrier, insuranceConfirmed, idAcknowledged,
      licenseDocUrl, insuranceDocUrl, idDocUrl, agreementSignedName } = body || {};
    if (!tenantId || !boothId || !startDate || !endDate || !name || (!phone && !email) || !returnUrl) {
      return NextResponse.json({ ok: false, error: 'Missing required fields.' }, { status: 400 });
    }
    const isHourly = bookingType === 'hourly';
    const numDays = daysInclusive(startDate, endDate);
    if (isHourly) {
      if (startDate !== endDate) return NextResponse.json({ ok: false, error: 'Hourly bookings are for a single day.' }, { status: 400 });
      if (!/^\d{2}:\d{2}$/.test(startTime || '') || !/^\d{2}:\d{2}$/.test(endTime || '') || startTime >= endTime) {
        return NextResponse.json({ ok: false, error: 'Invalid time range.' }, { status: 400 });
      }
    } else if (numDays < 1 || numDays > 60) {
      return NextResponse.json({ ok: false, error: 'Invalid date range.' }, { status: 400 });
    }

    const db = getAdminDb();
    const boothSnap = await db.doc(`tenants/${tenantId}/booths/${boothId}`).get();
    if (!boothSnap.exists) return NextResponse.json({ ok: false, error: 'Space not found.' }, { status: 404 });
    const booth = boothSnap.data() as any;
    // v85 — 'partial' booths (shared leases) take guest bookings too, just
    // never inside the resident renters' scheduled windows (checked below).
    //
    // A booth inside an approved SUBLET window reads as occupied — its lease
    // is still live, the renter is simply away — so 'occupied' is allowed
    // through for those dates only. Maintenance is NOT: an out-of-service
    // chair stays out of service no matter who is on leave.
    const subletDates = subletOpenOn(booth, startDate) && subletOpenOn(booth, endDate);
    const statusOk = booth.status === 'vacant' || booth.status === 'partial'
      || (subletDates && booth.status !== 'maintenance');
    if (!statusOk) {
      return NextResponse.json({ ok: false, error: 'This space is no longer available.' }, { status: 409 });
    }
    const leaseClash = await leaseSlotConflict(db, tenantId, boothId, { startDate, endDate, bookingType, startTime, endTime });
    if (leaseClash) {
      return NextResponse.json({ ok: false, error: `That time isn't available — ${leaseClash}.` }, { status: 409 });
    }

    // ── AVAILABILITY ENGINE (v66): the owner's declared schedule is law.
    // Every day in the requested range must be an offerable weekday and
    // not a blackout date. Client-side validation mirrors this, but the
    // server is the enforcement point — never trust the picker.
    const schedDays: number[] | undefined = Array.isArray(booth.dayRentalDays) ? booth.dayRentalDays : undefined;
    const blackouts: string[] = Array.isArray(booth.blackoutDates) ? booth.blackoutDates : [];
    if (schedDays && schedDays.length === 0) {
      return NextResponse.json({ ok: false, error: 'This space does not offer day rentals.' }, { status: 400 });
    }
    for (let t = new Date(startDate + 'T00:00:00Z').getTime(), e = new Date(endDate + 'T00:00:00Z').getTime(); t <= e; t += DAY_MS) {
      const iso = new Date(t).toISOString().slice(0, 10);
      const dow = new Date(t).getUTCDay();
      if (schedDays && !schedDays.includes(dow)) {
        return NextResponse.json({ ok: false, error: `This space isn't available on ${iso} — check the available days and pick a different range.` }, { status: 400 });
      }
      if (blackouts.includes(iso)) {
        return NextResponse.json({ ok: false, error: `${iso} is unavailable — pick a different range.` }, { status: 400 });
      }
    }
    if (isHourly) {
      const openT = booth.openTime || '00:00';
      const closeT = booth.closeTime || '23:59';
      if (startTime < openT || endTime > closeT) {
        return NextResponse.json({ ok: false, error: `Hourly bookings are available ${openT} – ${closeT}.` }, { status: 400 });
      }
    }

    // Rate: prefer an explicit daily rate; server-side pricing only —
    // the client never dictates the amount.
    const options: any[] = Array.isArray(booth.pricingOptions) && booth.pricingOptions.length > 0
      ? booth.pricingOptions
      : [{ frequency: booth.baseRentFrequency || 'monthly', amountCents: booth.baseRentCents || 0 }];
    let amountCents: number;
    let unitsLabel: string;
    if (isHourly) {
      // v73 — SLOTS: when the guest booked a pre-set slot, price and times
      // come from the OWNER'S CONFIG, never the client. The submitted
      // times must match the slot exactly.
      const slots: any[] = Array.isArray(booth.bookingSlots) ? booth.bookingSlots : [];
      const matchedSlot = slotLabel
        ? slots.find(s => s.label === slotLabel && s.startTime === startTime && s.endTime === endTime && s.amountCents > 0)
        : null;
      if (slotLabel && !matchedSlot) {
        return NextResponse.json({ ok: false, error: 'That time slot is no longer offered — refresh and pick again.' }, { status: 400 });
      }
      const hourRate = options.find(o => o.frequency === 'hourly' && o.amountCents > 0);
      if (!matchedSlot && !hourRate) {
        return NextResponse.json({ ok: false, error: slots.length > 0 ? 'Pick one of the offered time slots.' : 'This space does not offer hourly booking.' }, { status: 400 });
      }
      if (matchedSlot) {
        amountCents = matchedSlot.amountCents;
        unitsLabel = matchedSlot.label + ` (${startTime}–${endTime})`;
      } else {
      const numHours = Math.round(((new Date(`2000-01-01T${endTime}:00Z`).getTime() - new Date(`2000-01-01T${startTime}:00Z`).getTime()) / 3600000) * 2) / 2;
      if (numHours < 1 || numHours > 14) return NextResponse.json({ ok: false, error: 'Hourly bookings are 1–14 hours.' }, { status: 400 });
      amountCents = Math.round(hourRate!.amountCents * numHours);
      unitsLabel = `${numHours} hour${numHours === 1 ? '' : 's'} (${startTime}–${endTime})`;
      }
    } else {
      const dayRate = options.find(o => o.frequency === 'daily' && o.amountCents > 0);
      if (!dayRate) {
        return NextResponse.json({ ok: false, error: 'This space does not offer daily booking.' }, { status: 400 });
      }
      amountCents = dayRate.amountCents * numDays;
      unitsLabel = `${numDays} day${numDays === 1 ? '' : 's'}`;
    }

    // ── RENTER RECOGNITION ────────────────────────────────────────────
    // Match this contact against renters + past paid visits (shared module —
    // the booking form's "welcome back" uses the same logic). A resident
    // renter gets the owner-configured day-booking discount (0 = off), and
    // their signed lease can stand in for the day-use re-sign below.
    // Recognition is additive: any failure here books as a normal guest.
    let recognition: Awaited<ReturnType<typeof recognizeContact>> | null = null;
    let renterDiscountCents = 0;
    try {
      recognition = await recognizeContact(db, tenantId, phone, email);
      // A renter barred over an unpaid balance is refused here, at the one
      // place a day rental is actually created — not warned, refused. The
      // message names the way back so it reads as a locked door, not a wall.
      if (recognition?.renterId) {
        const rSnap = await db.doc(`tenants/${tenantId}/renters/${recognition.renterId}`).get();
        if ((rSnap.data() as any)?.doNotRent === true) {
          const { resolveCollectionsPolicy } = await import('@/lib/collections-policy');
          const tSnapWall = await db.doc(`tenants/${tenantId}`).get();
          return NextResponse.json({
            ok: false,
            error: resolveCollectionsPolicy(tSnapWall.data()).wallMessage,
          }, { status: 403 });
        }
      }
      if (recognition?.isResident) {
        const tSnapEarly = await db.doc(`tenants/${tenantId}`).get();
        const pct = resolveRenterDayDiscount(tSnapEarly.data());
        if (pct > 0) {
          renterDiscountCents = Math.round(amountCents * (pct / 100));
          amountCents -= renterDiscountCents;
        }
      }
    } catch { recognition = null; }

    if (await findConflict(db, tenantId, boothId, { startDate, endDate, bookingType: isHourly ? 'hourly' : 'daily', startTime, endTime })) {
      return NextResponse.json({ ok: false, error: 'Those dates were just taken — try different dates.' }, { status: 409 });
    }

    // ── v69 CREDITS: unused-time credits from past stays auto-apply.
    // Matched by phone or email. Credits are 'reserved' at checkout and
    // 'consumed' on payment confirmation; stale reservations (>1h old,
    // payment never completed) are released back to available here.
    let creditAppliedCents = 0;
    const appliedCreditIds: string[] = [];
    try {
      const contactKeys = [phone, email].map(v => (v || '').trim()).filter(Boolean);
      if (contactKeys.length) {
        const credSnap = await db.collection(`tenants/${tenantId}/boothCredits`).where('contactKey', 'in', contactKeys.slice(0, 2)).get();
        const staleCutoff = Date.now() - 60 * 60 * 1000;
        for (const cd of credSnap.docs) {
          const cr = cd.data() as any;
          if (cr.status === 'reserved' && cr.reservedAt && new Date(cr.reservedAt).getTime() < staleCutoff) {
            await cd.ref.set({ status: 'available', reservedAt: null, reservedForReservationId: null }, { merge: true });
            cr.status = 'available';
          }
          if (cr.status !== 'available') continue;
          if (creditAppliedCents >= amountCents - 100) break;   // always charge ≥ $1 (Stripe minimum ~$0.50; $1 keeps it clean)
          const usable = Math.min(cr.amountCents, amountCents - 100 - creditAppliedCents);
          if (usable <= 0) break;
          creditAppliedCents += usable;
          appliedCreditIds.push(cd.id);
        }
      }
    } catch { /* credits are a bonus — never block a booking over them */ }
    const netCents = amountCents - creditAppliedCents;   // owed after credits

    // ── Tranche 2: deposit split. Per-space override wins; else tenant rule.
    // booth.depositPercent (0-100) or booth.depositRequired === false disables.
    let rules: any = {};
    let tenantData: any = {};
    try {
      const tSnap = await db.doc(`tenants/${tenantId}`).get();
      tenantData = (tSnap.data() as any) || {};
      rules = tenantData?.bookingPageSettings?.automationRules || {};
    } catch { /* defaults below */ }
    // Per-space deposit config wins ONLY when explicitly typed; otherwise
    // fall back to the tenant default. (Bug fix: a booth saved with
    // depositType 'none' or a legacy null percent must NOT block the
    // tenant default — we key off an explicit, non-'none' depositType.)
    const boothType: string | undefined = booth.depositType;
    const usePerSpace = boothType !== undefined && boothType !== null;
    const depositType = usePerSpace ? boothType
      : (rules.depositRequired ? (rules.depositType || 'percent') : 'none');
    const balanceMode = booth.balanceMode || rules.balanceMode || 'in_person'; // 'at_checkin' | 'in_person'

    // Compute the deposit by TYPE. netCents is the amount owed (post-credit).
    let chargeCents = netCents;
    let depositCents = 0;
    let balanceDueCents = 0;
    const hoursBooked = (isHourly && startTime && endTime)
      ? Math.max(0, (new Date(`2000-01-01T${endTime}:00`).getTime() - new Date(`2000-01-01T${startTime}:00`).getTime()) / 3600000)
      : (numDays || 1) * 8;   // day rental ≈ 8 billable hours for break-even math

    if (depositType === 'flat') {
      const flat = usePerSpace ? (Number(booth.depositFlatCents) || 0) : (Number(rules.depositFlatCents) || 0);
      depositCents = Math.min(netCents, Math.max(0, flat));
    } else if (depositType === 'percent') {
      const pct = usePerSpace ? (Number(booth.depositPercent) || 0) : (Number(rules.depositPercent) || 0);
      if (pct > 0 && pct < 100) depositCents = Math.max(100, Math.round(netCents * (pct / 100)));
    } else if (depositType === 'breakeven') {
      // Per-space cost wins; else the studio's TMHR (Total cost per hour
      // from Financial Foundation); else the tenant rule's configured rate.
      let hourly = usePerSpace ? (Number(booth.breakevenHourlyCents) || 0) : 0;
      if (hourly <= 0) {
        const tmhrDollars = Number(tenantData?.tmhr) || 0;   // stored in dollars/hr
        hourly = tmhrDollars > 0 ? Math.round(tmhrDollars * 100) : (Number(rules.breakevenHourlyCents) || 0);
      }
      depositCents = Math.min(netCents, Math.max(0, Math.round(hourly * hoursBooked)));
    }
    // Diagnostic trace — why did we charge what we charged? Stored on the
    // reservation so a "deposit didn't apply" is explainable at a glance.
    const depositTrace = {
      source: usePerSpace ? 'space' : (rules.depositRequired ? 'studio_default' : 'none'),
      resolvedType: depositType,
      boothDepositType: booth.depositType ?? null,
      studioDepositRequired: !!rules.depositRequired,
      tmhr: Number(tenantData?.tmhr) || 0,
      hoursBooked,
      computedDepositCents: depositCents,
      netCents,
    };
    console.log('[reserve] deposit trace', JSON.stringify(depositTrace));

    // Only split if the deposit is a real partial amount
    if (depositCents > 0 && depositCents < netCents && netCents > 100) {
      balanceDueCents = netCents - depositCents;
      chargeCents = depositCents;
    } else {
      depositCents = 0;   // full payment (deposit ≥ total or zero)
    }

    // ── DAY-USE AGREEMENT (protect the business) ─────────────────────────
    // Every short-term guest type-signs real, protective terms before their
    // card is charged. The owner can disable the hard requirement, but it is
    // ON by default so no one uses the space without an agreement on file.
    // The text is resolved and SNAPSHOTTED server-side (never trusting the
    // client), then persisted to the write-once legal store on confirm.
    const requireSignature = tenantData?.bookingPageSettings?.requireBookingSignature !== false;
    // A resident renter with a SIGNED lease already has an agreement on file
    // covering conduct, licensing, and incidentals — their lease stands in
    // for the day-use re-sign. Everyone else signs.
    const signatureWaived = !!(recognition?.isResident && recognition?.hasSignedLease);
    const signedName = String(agreementSignedName || '').trim().slice(0, 120);
    if (requireSignature && !signatureWaived && signedName.length < 2) {
      return NextResponse.json({ ok: false, error: 'Please type your name to sign the rental agreement before booking.' }, { status: 400 });
    }
    const bookingWindow = isHourly
      ? `${startDate} · ${startTime}–${endTime}`
      : (startDate === endDate ? startDate : `${startDate} → ${endDate}`);
    const agreement = resolveDayUseAgreement(findBookingTerms(tenantData), {
      // Same rule as the walk-in kiosk: the date on a signed agreement is the
      // studio's date, not the server's.
      date: todayIn(tenantTimeZone(tenantData)),
      studioName: tenantData?.name || tenantData?.businessName || 'The Studio',
      signerName: String(name),
      boothName: booth.name || 'the space',
      bookingWindow,
      amount: `$${(amountCents / 100).toFixed(2)}`,
      incidentalsSchedule: incidentalScheduleText(resolveIncidentalPolicy(tenantData)),
    });

    // ── DAY-PASS REDEMPTION ──────────────────────────────────────────
    // A guest with an active prepaid pack books WITHOUT paying again: the
    // reservation confirms immediately and pass days are consumed inside a
    // transaction (no double-spend). Revenue was recognized at pack sale, so
    // no new ledger income here. The signed agreement above is still
    // enforced. Any hiccup falls through to normal paid checkout.
    const passKeyPhone = String(phone || '').replace(/\D/g, '');
    const passKeyMail = String(email || '').trim().toLowerCase();
    const passDaysNeeded = isHourly ? 1 : numDays;
    try {
      const passSnap = await db.collection(`tenants/${tenantId}/boothPasses`).where('status', '==', 'active').get();
      const passDoc = passSnap.docs.find((d) => {
        const p = d.data() as any;
        const match = (passKeyPhone && p.contactKey === passKeyPhone) || (passKeyMail && p.contactKey === passKeyMail);
        return match && ((Number(p.daysTotal) || 0) - (Number(p.daysUsed) || 0)) >= passDaysNeeded;
      });
      if (passDoc) {
        const passRef = db.collection(`tenants/${tenantId}/boothReservations`).doc();
        const nowPass = new Date().toISOString();
        const resData: any = {
          id: passRef.id, tenantId, boothId,
          boothName: booth.name || 'Space',
          locationId: booth.locationId || null,
          name: String(name).slice(0, 120), phone: String(phone || '').slice(0, 40), email: String(email || '').slice(0, 160),
          startDate, endDate, numDays,
          amountCents: 0, originalAmountCents: amountCents, netDueCents: 0,
          depositCents: 0, balanceDueCents: 0, balanceMode: null, balancePaid: true,
          creditAppliedCents: 0, appliedCreditIds: [],
          stripeCustomerId: null, cardOnFile: false,
          bookingType: isHourly ? 'hourly' : 'daily',
          slotLabel: slotLabel || null,
          startTime: isHourly ? startTime : null,
          endTime: isHourly ? endTime : null,
          status: 'confirmed', createdAt: nowPass, confirmedAt: nowPass,
          paidWithPassId: passDoc.id, passDaysUsed: passDaysNeeded,
          consentAccepted: !!consentAccepted, consentAcceptedAt: consentAccepted ? nowPass : null,
          doingServices: !!doingServices,
          licenseNumber: licenseNumber || null,
          insuranceCarrier: insuranceCarrier || null,
          insuranceConfirmed: !!insuranceConfirmed,
          idAcknowledged: !!idAcknowledged,
          licenseDocUrl: licenseDocUrl || null,
          insuranceDocUrl: insuranceDocUrl || null,
          idDocUrl: idDocUrl || null,
          agreementTitle: agreement.title,
          agreementText: agreement.text,
          agreementSignedName: signedName || null,
          agreementSignedAt: signedName ? nowPass : null,
          agreementWaived: signatureWaived,
          renterId: recognition?.renterId || null,
          guestTier: recognition?.tier || 'new',
          renterDiscountCents: 0,
        };
        await db.runTransaction(async (tx: any) => {
          const fresh = await tx.get(passDoc.ref);
          const p = (fresh.data() as any) || {};
          const left = (Number(p.daysTotal) || 0) - (Number(p.daysUsed) || 0);
          if (p.status !== 'active' || left < passDaysNeeded) throw new Error('pass-consumed');
          const newUsed = (Number(p.daysUsed) || 0) + passDaysNeeded;
          tx.update(passDoc.ref, {
            daysUsed: newUsed,
            status: newUsed >= (Number(p.daysTotal) || 0) ? 'used_up' : 'active',
            lastUsedAt: nowPass,
          });
          tx.set(passRef, resData);
        });
        await persistDayUseSignature(db, tenantId, passRef.id, resData);
        // A pass booking is confirmed the moment it is created — there is no
        // Stripe return trip to hang this on, so grant here. Without it the
        // nightly reconcile was the first thing to notice, meaning a renter
        // who paid with a pass stayed unbookable for up to a day.
        await syncReservationAvailability(db, tenantId, passRef.id, resData, true);
        const pd = passDoc.data() as any;
        const daysLeft = Math.max(0, (Number(pd.daysTotal) || 0) - (Number(pd.daysUsed) || 0) - passDaysNeeded);
        const nRef = db.collection(`tenants/${tenantId}/notifications`).doc();
        await nRef.set({ id: nRef.id, type: 'booth_reservation', read: false, createdAt: nowPass, link: '/pos?tab=spaces',
          message: `Pass booking: ${resData.name} — ${resData.boothName}, ${startDate}${endDate !== startDate ? ` → ${endDate}` : ''} (${passDaysNeeded} pass day${passDaysNeeded === 1 ? '' : 's'} used · ${daysLeft} left)` });
        await logAuditAdmin(db, tenantId, {
          action: 'booth.pass_redeemed', targetType: 'boothReservation', targetId: passRef.id,
          summary: `${resData.name} booked ${resData.boothName} with a day pass (${passDaysNeeded} day${passDaysNeeded === 1 ? '' : 's'} used, ${daysLeft} left)`,
          actor: { type: 'system', name: 'booth-pass' },
        });
        // v18 — appointment-standard confirmation: branded email with
        // Manage + Add-to-calendar buttons, plus a text with the manage
        // link. Best-effort — the reservation is already confirmed.
        await sendReservationConfirmation(db, tenantId, passRef.id, resData, { originFallback: String(returnUrl).split('?')[0] });
        return NextResponse.json({ ok: true, passUsed: true, reservationId: passRef.id, boothName: resData.boothName, startDate, endDate, passDaysLeft: daysLeft });
      }
    } catch (err) {
      console.error('[booth-reserve] pass redemption failed — falling back to paid checkout', err);
    }

    const resRef = db.collection(`tenants/${tenantId}/boothReservations`).doc();
    const nowIso = new Date().toISOString();
    await resRef.set({
      id: resRef.id, tenantId, boothId,
      boothName: booth.name || 'Space',
      locationId: booth.locationId || null,
      name: String(name).slice(0, 120), phone: String(phone || '').slice(0, 40), email: String(email || '').slice(0, 160),
      startDate, endDate, numDays, amountCents: chargeCents,
      originalAmountCents: amountCents,
      netDueCents: netCents,
      depositCents, balanceDueCents,
      balanceMode: balanceDueCents > 0 ? balanceMode : null,
      balancePaid: false,
      depositTrace,
      creditAppliedCents,
      appliedCreditIds,
      stripeCustomerId: null as string | null,
      bookingType: isHourly ? 'hourly' : 'daily',
      slotLabel: slotLabel || null,
      startTime: isHourly ? startTime : null,
      endTime: isHourly ? endTime : null,
      status: 'pending_payment', createdAt: nowIso,
      consentAccepted: !!consentAccepted, consentAcceptedAt: consentAccepted ? nowIso : null,
      // Signed day-use agreement — snapshot of the EXACT terms shown, plus the
      // typed signature. Persisted to the write-once legal store on confirm.
      agreementTitle: agreement.title,
      agreementText: agreement.text,
      agreementSignedName: signedName || null,
      agreementSignedAt: signedName ? nowIso : null,
      agreementWaived: signatureWaived,
      // Recognition — who this guest is to the business (resident renter,
      // regular, returning, new) and any renter pricing applied.
      renterId: recognition?.renterId || null,
      guestTier: recognition?.tier || 'new',
      renterDiscountCents: renterDiscountCents || 0,
      // Tranche 1 — compliance captured at booking
      doingServices: !!doingServices,
      licenseNumber: licenseNumber || null,
      insuranceCarrier: insuranceCarrier || null,
      insuranceConfirmed: !!insuranceConfirmed,
      idAcknowledged: !!idAcknowledged,
      licenseDocUrl: licenseDocUrl || null,
      insuranceDocUrl: insuranceDocUrl || null,
      idDocUrl: idDocUrl || null,
      complianceCapturedAt: (doingServices || licenseNumber || insuranceConfirmed || idAcknowledged || licenseDocUrl || insuranceDocUrl || idDocUrl) ? nowIso : null,
    });

    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({ ok: false, error: 'Payments are not configured yet (missing Stripe key on the server). Add STRIPE_SECRET_KEY in Vercel → Settings → Environment Variables, then redeploy.' }, { status: 500 });
    }
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
    const base = String(returnUrl).split('?')[0];
    for (const cid of appliedCreditIds) {
      await db.doc(`tenants/${tenantId}/boothCredits/${cid}`).set(
        { status: 'reserved', reservedAt: nowIso, reservedForReservationId: resRef.id }, { merge: true });
    }

    // ── v70 CARD ON FILE (hotel model): every day/hourly booking saves
    // the card to a Stripe Customer for off-session incidental charges
    // (overages, damages). Stripe Checkout shows the card-save consent
    // language automatically when setup_future_usage is set.
    let customerId: string | null = null;
    try {
      if (email) {
        const existing = await stripe.customers.list({ email, limit: 1 });
        customerId = existing.data[0]?.id || null;
      }
      if (!customerId) {
        const created = await stripe.customers.create({
          email: email || undefined, phone: phone || undefined, name: name || undefined,
          metadata: { tenantId },
        });
        customerId = created.id;
      }
    } catch { customerId = null; /* booking must never fail over customer creation */ }

    const session = await stripe.checkout.sessions.create({
      ...(customerId ? { customer: customerId } : {}),
      payment_intent_data: { setup_future_usage: 'off_session' },
      mode: 'payment',
      ...(customerId ? {} : { customer_email: email || undefined }),
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: chargeCents,
          product_data: {
            name: `${booth.name || 'Space'} — ${unitsLabel}`
              + (depositCents > 0 ? ` (deposit)` : ''),
            description: (isHourly ? `${startDate} · ${startTime}–${endTime}` : `${startDate} → ${endDate}`)
              + (depositCents > 0 ? ` · $${(depositCents / 100).toFixed(2)} deposit of $${(netCents / 100).toFixed(2)} · balance $${(balanceDueCents / 100).toFixed(2)} ${balanceMode === 'at_checkin' ? 'at check-in' : 'in person'}` : '')
              + (creditAppliedCents > 0 ? ` · $${(creditAppliedCents / 100).toFixed(2)} credit applied` : '')
              + (renterDiscountCents > 0 ? ` · $${(renterDiscountCents / 100).toFixed(2)} renter discount` : ''),
          },
        },
      }],
      success_url: `${base}?cfReservationId=${resRef.id}&cfSession={CHECKOUT_SESSION_ID}`,
      cancel_url: base,
      metadata: { tenantId, reservationId: resRef.id },
    });
    await resRef.set({ stripeSessionId: session.id, stripeCustomerId: customerId }, { merge: true });
    return NextResponse.json({ ok: true, url: session.url });
  } catch (err: any) {
    console.error('[booth-reserve] POST failed', err);
    const detail = String(err?.raw?.message || err?.message || '').slice(0, 180);
    return NextResponse.json({ ok: false, error: `Could not start checkout${detail ? `: ${detail}` : '.'}` }, { status: 500 });
  }
}


// Fetch the exact Stripe fee for a payment intent via its charge's
// balance transaction. Fail-open: fee recording must never block revenue.
async function stripeFeeFor(paymentIntentId: string | null): Promise<{ feeCents: number; chargeId: string | null }> {
  try {
    if (!paymentIntentId || !process.env.STRIPE_SECRET_KEY) return { feeCents: 0, chargeId: null };
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
    const pi: any = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge.balance_transaction'] });
    const charge: any = pi?.latest_charge;
    const bt: any = charge?.balance_transaction;
    return { feeCents: Number(bt?.fee) || 0, chargeId: charge?.id || null };
  } catch { return { feeCents: 0, chargeId: null }; }
}

// Robust fee resolver for OFF-SESSION charges. They settle in the same request,
// so the balance-transaction fee may not be readable yet. Try the expanded
// intent, then a re-fetch, then fall back to an ESTIMATE (US standard 2.9% +
// $0.30) so the processing-fee expense is NEVER silently dropped.
async function resolveFeeCents(intent: any, grossCents: number): Promise<{ feeCents: number; chargeId: string | null; estimated: boolean }> {
  const charge: any = intent?.latest_charge;
  let chargeId: string | null = (charge && typeof charge === 'object') ? (charge.id || null) : (typeof charge === 'string' ? charge : null);
  const bt: any = (charge && typeof charge === 'object') ? charge.balance_transaction : null;
  let fee = (bt && typeof bt === 'object') ? (Number(bt.fee) || 0) : 0;
  if (!fee && intent?.id) {
    const r = await stripeFeeFor(intent.id);
    fee = r.feeCents; chargeId = chargeId || r.chargeId;
  }
  if (!fee && grossCents > 0) return { feeCents: Math.round(grossCents * 0.029) + 30, chargeId, estimated: true };
  return { feeCents: fee, chargeId, estimated: false };
}

// Canonical Transaction shape (verified against the Ledger page):
// amount in DOLLARS, required type 'income'.
async function writeLedgerTxn(db: FirebaseFirestore.Firestore, tenantId: string, reservationId: string, r: any, paymentIntentId: string | null) {
  const txnRef = db.collection(`tenants/${tenantId}/transactions`).doc();
  const nowIso = new Date().toISOString();
  const { feeCents, chargeId } = await stripeFeeFor(paymentIntentId);
  await txnRef.set({
    id:                    txnRef.id,
    type:                  'income',
    context:               'Business',
    taxBucket:             'revenue',
    // v74 — REQUIRED: every booth ledger view filters on this field;
    // without it, paid bookings were invisible in the booth Money tab.
    source:                'booth_rent',
    amount:                (r.amountCents || 0) / 100,
    stripeFeeCents:        feeCents || null,
    netAmountCents:        feeCents ? (r.amountCents || 0) - feeCents : null,
    category:              'Booth Rent',
    description:           r.bookingType === 'hourly'
      ? `Hourly rental — ${r.boothName || 'Space'} — ${r.name} (${r.startDate} ${r.startTime}–${r.endTime})`
      : `Day rental — ${r.boothName || 'Space'} — ${r.name} (${r.startDate} → ${r.endDate})`,
    clientOrVendor:        r.name || 'Day renter',
    date:                  nowIso,
    paymentMethod:         'Card (Stripe)',
    hasReceipt:            false,
    checkoutSessionId:     r.stripeSessionId || null,
    stripePaymentIntentId: paymentIntentId,
    stripeChargeId:        chargeId,
    sourceId:              reservationId,
    tenantId,
    createdAt:             nowIso,
  });

  // Paired expense: the processing fee Stripe deducts before payout.
  // Without this the P&L overstates revenue and the fee disappears.
  if (feeCents > 0) {
    const feeRef = db.collection(`tenants/${tenantId}/transactions`).doc();
    await feeRef.set({
      id: feeRef.id,
      type: 'expense',
      context: 'Business',
      taxBucket: 'operating_cost',
      amount: feeCents / 100,
      category: 'Processing Fee',
      description: `Stripe fee — ${r.bookingType === 'hourly' ? 'hourly' : 'day'} rental — ${r.boothName || 'Space'} (${r.name})`,
      clientOrVendor: 'Stripe',
      date: nowIso,
      paymentMethod: 'Deducted from payout',
      hasReceipt: false,
      stripePaymentIntentId: paymentIntentId,
      stripeChargeId: chargeId,
      sourceId: reservationId,
      relatedTxnId: txnRef.id,
      tenantId,
      createdAt: nowIso,
    });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get('tenantId');
    const reservationId = searchParams.get('reservationId');
    const sessionId = searchParams.get('sessionId');

    // ── Confirm a DAY-PASS purchase (idempotent) ─────────────────────
    const passPurchaseId = searchParams.get('passPurchaseId');
    if (tenantId && passPurchaseId && sessionId) {
      const db = getAdminDb();
      const purRef = db.doc(`tenants/${tenantId}/boothPassPurchases/${passPurchaseId}`);
      const purSnap = await purRef.get();
      if (!purSnap.exists) return NextResponse.json({ ok: false, error: 'Purchase not found.' }, { status: 404 });
      const pur = purSnap.data() as any;
      if (pur.status === 'completed') {
        return NextResponse.json({ ok: true, passPurchased: true, days: pur.days, label: pur.packLabel });
      }
      if (pur.stripeSessionId !== sessionId) {
        return NextResponse.json({ ok: false, error: 'Session mismatch.' }, { status: 400 });
      }
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
      const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['payment_intent'] });
      if (session.payment_status !== 'paid') {
        return NextResponse.json({ ok: false, error: 'Payment not completed.' });
      }
      const nowIso = new Date().toISOString();
      const piId = typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent as any)?.id || null;
      const contactKey = String(pur.phone || '').replace(/\D/g, '') || String(pur.email || '').trim().toLowerCase();
      const passRef = db.collection(`tenants/${tenantId}/boothPasses`).doc();
      await passRef.set({
        id: passRef.id, tenantId, contactKey,
        name: pur.name || 'Guest', phone: pur.phone || '', email: pur.email || '',
        packLabel: pur.packLabel, daysTotal: pur.days, daysUsed: 0,
        amountCents: pur.amountCents, pricePerDayCents: Math.round(pur.amountCents / pur.days),
        status: 'active', method: 'Card (Stripe)', purchasedAt: nowIso, createdAt: nowIso,
        stripePaymentIntentId: piId, purchaseId: passPurchaseId,
      });
      const txnRef = db.collection(`tenants/${tenantId}/transactions`).doc();
      const { feeCents, chargeId } = await stripeFeeFor(piId);
      await txnRef.set({
        id: txnRef.id, type: 'income', context: 'Business', taxBucket: 'revenue', source: 'booth_rent',
        amount: (pur.amountCents || 0) / 100, category: 'Day Pass',
        description: `Day pass (${pur.days} days) — ${pur.name || 'guest'} (online)`,
        clientOrVendor: pur.name || 'Guest', date: nowIso, paymentMethod: 'Card (Stripe)',
        stripeFeeCents: feeCents || null, stripePaymentIntentId: piId, stripeChargeId: chargeId,
        hasReceipt: false, sourceId: passRef.id, tenantId, createdAt: nowIso,
      });
      if (feeCents > 0) {
        const feeRef = db.collection(`tenants/${tenantId}/transactions`).doc();
        await feeRef.set({
          id: feeRef.id, type: 'expense', context: 'Business', taxBucket: 'operating_cost',
          amount: feeCents / 100, category: 'Processing Fee',
          description: `Stripe fee — day pass (${pur.name || 'guest'})`,
          clientOrVendor: 'Stripe', date: nowIso, paymentMethod: 'Deducted from payout',
          hasReceipt: false, stripePaymentIntentId: piId, stripeChargeId: chargeId,
          sourceId: passRef.id, relatedTxnId: txnRef.id, tenantId, createdAt: nowIso,
        });
      }
      await purRef.set({ status: 'completed', completedAt: nowIso, passId: passRef.id, stripePaymentIntentId: piId }, { merge: true });
      const nRef = db.collection(`tenants/${tenantId}/notifications`).doc();
      await nRef.set({ id: nRef.id, type: 'booth_reservation', read: false, createdAt: nowIso, link: '/pos?tab=spaces',
        message: `Day pass sold online: ${pur.name} bought ${pur.packLabel} ($${((pur.amountCents || 0) / 100).toFixed(2)})` });
      await logAuditAdmin(db, tenantId, {
        action: 'booth.pass_sold', targetType: 'boothPass', targetId: passRef.id,
        summary: `${pur.name || 'Guest'} bought ${pur.packLabel} online — $${((pur.amountCents || 0) / 100).toFixed(2)}`,
        amount: (pur.amountCents || 0) / 100, actor: { type: 'system', name: 'booking-page' },
      });
      return NextResponse.json({ ok: true, passPurchased: true, days: pur.days, label: pur.packLabel });
    }

    if (!tenantId || !reservationId || !sessionId) {
      return NextResponse.json({ ok: false, error: 'Missing parameters.' }, { status: 400 });
    }
    const db = getAdminDb();
    const resRef = db.doc(`tenants/${tenantId}/boothReservations/${reservationId}`);
    const resSnap = await resRef.get();
    if (!resSnap.exists) return NextResponse.json({ ok: false, error: 'Reservation not found.' }, { status: 404 });
    const r = resSnap.data() as any;
    if (r.status === 'confirmed') {
      // v59 — self-heal: reservations confirmed before ledger reporting
      // existed (or whose txn write failed) get their entry on the next
      // confirmation call instead of never.
      const existing = await db.collection(`tenants/${tenantId}/transactions`).where('sourceId', '==', reservationId).limit(1).get();
      if (existing.empty) await writeLedgerTxn(db, tenantId, reservationId, r, r.stripePaymentIntentId || null);
      await persistDayUseSignature(db, tenantId, reservationId, r);
      // Same self-heal the ledger gets: reservations confirmed before
      // availability granting existed pick it up on the next call.
      await syncReservationAvailability(db, tenantId, reservationId, r, true);
      return NextResponse.json({ ok: true, confirmed: true, boothName: r.boothName, startDate: r.startDate, endDate: r.endDate });
    }
    if (r.stripeSessionId !== sessionId) {
      return NextResponse.json({ ok: false, error: 'Session mismatch.' }, { status: 400 });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['payment_intent'] });
    const pi: any = session.payment_intent;
    const savedPaymentMethodId: string | null = (pi && typeof pi === 'object' && pi.payment_method) ? String(pi.payment_method) : null;
    if (session.payment_status !== 'paid') {
      return NextResponse.json({ ok: false, confirmed: false, error: 'Payment not completed.' });
    }

    // Close the race window: dates may have been confirmed by another
    // checkout while this one was on Stripe.
    const conflicted = await findConflict(db, tenantId, r.boothId, { startDate: r.startDate, endDate: r.endDate, bookingType: r.bookingType, startTime: r.startTime, endTime: r.endTime }, reservationId)
      || !!(await leaseSlotConflict(db, tenantId, r.boothId, { startDate: r.startDate, endDate: r.endDate, bookingType: r.bookingType, startTime: r.startTime, endTime: r.endTime }));
    const nowIso = new Date().toISOString();
    if (conflicted) {
      await resRef.set({ status: 'payment_received_conflict', confirmedAt: nowIso }, { merge: true });
      const nRef = db.collection(`tenants/${tenantId}/notifications`).doc();
      await nRef.set({ id: nRef.id, type: 'booth_reservation', read: false, createdAt: nowIso, link: '/pos?tab=spaces',
        message: `⚠ PAID but dates conflict: ${r.name} paid for ${r.boothName} ${r.startDate} → ${r.endDate}. Refund or rebook needed.` });
      return NextResponse.json({ ok: false, confirmed: false, error: 'Payment received, but those dates were just taken. The studio will contact you to reschedule or refund.' });
    }

    await resRef.set({
      status: 'confirmed', confirmedAt: nowIso,
      stripePaymentIntentId: (typeof session.payment_intent === 'string' ? session.payment_intent : pi?.id) || null,
      stripePaymentMethodId: savedPaymentMethodId,
      cardOnFile: !!savedPaymentMethodId,
    }, { merge: true });
    for (const cid of (r.appliedCreditIds || [])) {
      await db.doc(`tenants/${tenantId}/boothCredits/${cid}`).set(
        { status: 'consumed', consumedAt: nowIso, consumedByReservationId: reservationId }, { merge: true });
    }

    // v54 — REPORT TO LEDGER. Same collection and shape as the service's
    // buildLedgerEntry (tenants/{tid}/transactions), so day-rental income
    // sits beside booth rent in every financial view.
    await writeLedgerTxn(db, tenantId, reservationId, r, (typeof session.payment_intent === 'string' ? session.payment_intent : pi?.id) || null);
    await persistDayUseSignature(db, tenantId, reservationId, r);
    const availability = await syncReservationAvailability(db, tenantId, reservationId, r, true);
    const nRef = db.collection(`tenants/${tenantId}/notifications`).doc();
    await nRef.set({ id: nRef.id, type: 'booth_reservation', read: false, createdAt: nowIso, link: '/pos?tab=spaces',
      message: `💰 Day rental booked & paid: ${r.name} — ${r.boothName}, ${r.startDate} → ${r.endDate} ($${(r.amountCents / 100).toFixed(2)})`
        + (availability.granted > 0 ? ` · bookable ${availability.granted === 1 ? 'that day' : `${availability.granted} days`}` : '')
        + (availability.skipped.length > 0 ? ` · not bookable: ${availability.skipped.join('; ')}` : '') });
    await logAuditAdmin(db, tenantId, {
      action: 'booth.booking_paid', targetType: 'boothReservation', targetId: reservationId,
      summary: `Booking paid via Stripe: ${r.name || 'guest'} · ${r.boothName || 'space'} (${r.startDate}${r.endDate !== r.startDate ? ` → ${r.endDate}` : ''})${(r.creditAppliedCents || 0) > 0 ? ` · $${((r.creditAppliedCents || 0) / 100).toFixed(2)} credit applied` : ''}`,
      amount: (r.amountCents || 0) / 100, actor: { type: 'system', name: 'booth-checkout' },
    });
    // v18 — appointment-standard confirmation (branded email w/ Manage +
    // Add-to-calendar, plus text). Idempotent: the helper stamps the
    // reservation so a success-page refresh never double-sends.
    await sendReservationConfirmation(db, tenantId, reservationId, r, { originFallback: new URL(req.url).origin });
    return NextResponse.json({ ok: true, confirmed: true, boothName: r.boothName, startDate: r.startDate, endDate: r.endDate });
  } catch (err) {
    console.error('[booth-reserve] GET failed', err);
    return NextResponse.json({ ok: false, error: 'Could not confirm reservation.' }, { status: 500 });
  }
}

// ── PUT: charge an incidental (overage) to the card on file ──────────────────
// Body: { tenantId, reservationId }
// Charges reservation.overageDueCents off-session to the saved payment
// method. On success: ledger entry + overageStatus 'charged'. On card
// failure (declined/expired): returns the error so the owner falls back
// to in-person collection — the flag stays 'due'.
export async function PUT(req: NextRequest) {
  try {
    const { tenantId, reservationId } = await req.json();
    if (!tenantId || !reservationId) {
      return NextResponse.json({ ok: false, error: 'Missing parameters.' }, { status: 400 });
    }
    const db = getAdminDb();
    const resRef = db.doc(`tenants/${tenantId}/boothReservations/${reservationId}`);
    const snap = await resRef.get();
    if (!snap.exists) return NextResponse.json({ ok: false, error: 'Reservation not found.' }, { status: 404 });
    const r = snap.data() as any;

    if (r.overageStatus !== 'due' || !(r.overageDueCents > 0)) {
      return NextResponse.json({ ok: false, error: 'No overage due on this reservation.' }, { status: 400 });
    }
    if (!r.stripeCustomerId || !r.stripePaymentMethodId) {
      return NextResponse.json({ ok: false, error: 'No card on file for this booking — collect in person.' }, { status: 400 });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
    let intent;
    try {
      intent = await stripe.paymentIntents.create({
        amount: r.overageDueCents,
        currency: 'usd',
        customer: r.stripeCustomerId,
        payment_method: r.stripePaymentMethodId,
        off_session: true,
        confirm: true,
        expand: ['latest_charge.balance_transaction'],
        description: `Overage — ${r.boothName || 'Space'} — ${r.name} (+${r.overageMinutes} min)`,
        metadata: { tenantId, reservationId, kind: 'booth_overage' },
      });
    } catch (err: any) {
      const msg = err?.raw?.message || err?.message || 'Card charge failed.';
      return NextResponse.json({ ok: false, error: `Card charge failed: ${msg} — collect in person instead.` }, { status: 402 });
    }

    const nowIso = new Date().toISOString();
    const txnRef = db.collection(`tenants/${tenantId}/transactions`).doc();
    await txnRef.set({
      id: txnRef.id, type: 'income', context: 'Business', taxBucket: 'revenue',
      source: 'booth_rent',
      amount: r.overageDueCents / 100, category: 'Booth Rent',
      description: `Overage — ${r.boothName || 'Space'} — ${r.name} (+${r.overageMinutes} min)`,
      clientOrVendor: r.name || 'Day renter', date: nowIso, paymentMethod: 'Card on file (Stripe)',
      hasReceipt: false, stripePaymentIntentId: intent.id, sourceId: reservationId, tenantId, createdAt: nowIso,
    });
    // Paired Stripe processing-fee expense — resolved robustly so it's never dropped.
    {
      const { feeCents, chargeId, estimated } = await resolveFeeCents(intent, r.overageDueCents);
      if (feeCents > 0) {
        const feeRef = db.collection(`tenants/${tenantId}/transactions`).doc();
        await feeRef.set({
          id: feeRef.id, type: 'expense', context: 'Business', taxBucket: 'operating_cost',
          amount: feeCents / 100, category: 'Processing Fee', estimated,
          description: `Stripe fee${estimated ? ' (est.)' : ''} — overage — ${r.boothName || 'Space'} (${r.name})`,
          clientOrVendor: 'Stripe', date: nowIso, paymentMethod: 'Deducted from payout',
          hasReceipt: false, stripePaymentIntentId: intent.id, stripeChargeId: chargeId,
          sourceId: reservationId, relatedTxnId: txnRef.id, tenantId, createdAt: nowIso,
        });
      }
    }
    // v74 — removed: this block was an exact DUPLICATE of the fee write
    // above, double-counting the Stripe fee expense on every overage charge.

    await resRef.set({ overageStatus: 'charged', overageChargedAt: nowIso, overagePaymentIntentId: intent.id }, { merge: true });

    return NextResponse.json({ ok: true, chargedCents: r.overageDueCents });
  } catch (err) {
    console.error('[booth-reserve] PUT failed', err);
    return NextResponse.json({ ok: false, error: 'Could not charge overage.' }, { status: 500 });
  }
}


// ── PATCH: real Stripe refund for a paid reservation ─────────────────────────
// v74 — replaces the old "Mark Refunded" status flip, which moved no money
// and left the ledger permanently showing income for refunded stays.
// Body: { tenantId, reservationId, amountCents?, reason?, actor? }
//   amountCents — optional partial refund; defaults to the full charge.
// Does, atomically in sequence with idempotency guards:
//   1. stripe.refunds.create against the booking's PaymentIntent
//   2. ledger reversal (type 'reversal', category 'Refunds', source
//      'booth_rent') so booth income reports stay truthful
//   3. reservation → status 'refunded' with the Stripe refund id
//   4. audit entry naming who refunded and why
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { tenantId, reservationId, reason } = body || {};
    if (!tenantId || !reservationId) {
      return NextResponse.json({ ok: false, error: 'Missing parameters.' }, { status: 400 });
    }
    const db = getAdminDb();
    const resRef = db.doc(`tenants/${tenantId}/boothReservations/${reservationId}`);
    const snap = await resRef.get();
    if (!snap.exists) return NextResponse.json({ ok: false, error: 'Reservation not found.' }, { status: 404 });
    const r = snap.data() as any;

    // ── INCIDENTAL (action:'incidental') — charge an arbitrary amount (damage,
    // cleaning, lost key, product) to the reservation's card on file, hotel-
    // style. Off-session + confirmed; records to the ledger with a paired
    // Stripe-fee expense, and appends to the reservation's incidentals log.
    if (body.action === 'incidental') {
      const amountCents = Math.round(Number(body.amountCents) || 0);
      if (!r.stripeCustomerId || !r.stripePaymentMethodId) {
        return NextResponse.json({ ok: false, error: 'No card on file for this booking — collect in person.' }, { status: 400 });
      }
      // ── Incidentals policy — no made-up charges. Only owner-defined charge
      // types are allowed, and each is capped. Validated HERE (server) via the
      // shared policy module so it holds even if the UI is bypassed, and stays
      // in lockstep with the monthly-renter path and the signed lease.
      const cats = resolveIncidentalPolicy((await db.doc(`tenants/${tenantId}`).get()).data());
      const v = validateIncidental(cats, String(body.category || body.description || ''), amountCents, String(body.note || ''));
      if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: v.status });
      const description = v.description;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
      let intent;
      try {
        intent = await stripe.paymentIntents.create({
          amount: amountCents, currency: 'usd',
          customer: r.stripeCustomerId, payment_method: r.stripePaymentMethodId,
          off_session: true, confirm: true,
          expand: ['latest_charge.balance_transaction'],
          description: `Incidental — ${r.boothName || 'Space'} — ${r.name}: ${description}`,
          metadata: { tenantId, reservationId, kind: 'booth_incidental' },
        });
      } catch (err: any) {
        const msg = err?.raw?.message || err?.message || 'Card charge failed.';
        return NextResponse.json({ ok: false, error: `Card charge failed: ${msg} — collect in person instead.` }, { status: 402 });
      }
      const nowIso = new Date().toISOString();
      const txnRef = db.collection(`tenants/${tenantId}/transactions`).doc();
      await txnRef.set({
        id: txnRef.id, type: 'income', context: 'Business', taxBucket: 'revenue', source: 'booth_rent',
        amount: amountCents / 100, category: 'Renter Incidental',
        description: `Incidental — ${r.boothName || 'Space'} — ${r.name}: ${description}`,
        clientOrVendor: r.name || 'Day renter', date: nowIso, paymentMethod: 'Card on file (Stripe)',
        hasReceipt: false, stripePaymentIntentId: intent.id, sourceId: reservationId, tenantId, createdAt: nowIso,
      });
      try {
        const { feeCents, chargeId, estimated } = await resolveFeeCents(intent, amountCents);
        if (feeCents > 0) {
          const feeRef = db.collection(`tenants/${tenantId}/transactions`).doc();
          await feeRef.set({
            id: feeRef.id, type: 'expense', context: 'Business', taxBucket: 'operating_cost',
            amount: feeCents / 100, category: 'Processing Fee', estimated,
            description: `Stripe fee${estimated ? ' (est.)' : ''} — incidental — ${r.boothName || 'Space'} (${r.name})`,
            clientOrVendor: 'Stripe', date: nowIso, paymentMethod: 'Deducted from payout',
            hasReceipt: false, stripePaymentIntentId: intent.id, stripeChargeId: chargeId,
            sourceId: reservationId, relatedTxnId: txnRef.id, tenantId, createdAt: nowIso,
          });
        }
      } catch { /* fee accounting is best-effort */ }
      const list = Array.isArray(r.incidentals) ? r.incidentals : [];
      list.push({ amountCents, description, at: nowIso, paymentIntentId: intent.id });
      await resRef.set({ incidentals: list, incidentalsTotalCents: (r.incidentalsTotalCents || 0) + amountCents }, { merge: true });
      await logAuditAdmin(db, tenantId, {
        action: 'booth.incidental_charged', targetType: 'boothReservation', targetId: reservationId,
        summary: `Incidental charged: ${r.name || 'guest'} · ${r.boothName || 'space'} — ${description} ($${(amountCents / 100).toFixed(2)})`,
        amount: amountCents / 100, actor: { type: 'system', name: 'booth-incidental' },
      });
      return NextResponse.json({ ok: true, chargedCents: amountCents });
    }

    // ── v85: RESCHEDULE (action:'reschedule') — same length, new time, ─────
    // conflict-checked against other bookings AND resident-renter slots.
    if (body.action === 'reschedule') {
      if (r.status !== 'confirmed') {
        return NextResponse.json({ ok: false, error: `A ${String(r.status).replace(/_/g, ' ')} reservation can't be rescheduled — cancel and rebook instead.` }, { status: 400 });
      }
      const startDate = String(body.startDate || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
        return NextResponse.json({ ok: false, error: 'Invalid date.' }, { status: 400 });
      }
      const isHourly = r.bookingType === 'hourly';
      // Daily: omitting endDate keeps the same length automatically.
      let endDate = String(body.endDate || '').slice(0, 10);
      if (!endDate || isHourly) {
        if (isHourly) endDate = startDate;
        else {
          const n = (r.numDays || daysInclusive(r.startDate, r.endDate)) - 1;
          const t = new Date(startDate + 'T00:00:00Z');
          t.setUTCDate(t.getUTCDate() + n);
          endDate = t.toISOString().slice(0, 10);
        }
      }
      if (endDate < startDate) return NextResponse.json({ ok: false, error: 'Invalid dates.' }, { status: 400 });
      const startTime = isHourly ? String(body.startTime || r.startTime || '') : null;
      const endTime = isHourly ? String(body.endTime || r.endTime || '') : null;
      if (isHourly && (!/^\d{2}:\d{2}$/.test(startTime || '') || !/^\d{2}:\d{2}$/.test(endTime || '') || (startTime as string) >= (endTime as string))) {
        return NextResponse.json({ ok: false, error: 'Invalid time range.' }, { status: 400 });
      }
      // Same-length rule: a different duration is a different price —
      // that's a cancel-and-rebook (refund path), not a reschedule.
      const newDays = daysInclusive(startDate, endDate);
      if (!isHourly && newDays !== (r.numDays || daysInclusive(r.startDate, r.endDate))) {
        return NextResponse.json({ ok: false, error: 'Reschedules keep the same number of days — for a different length, cancel (refund) and rebook.' }, { status: 400 });
      }
      if (isHourly) {
        const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
        if (mins(endTime as string) - mins(startTime as string) !== mins(r.endTime) - mins(r.startTime)) {
          return NextResponse.json({ ok: false, error: 'Reschedules keep the same duration — for a different length, cancel (refund) and rebook.' }, { status: 400 });
        }
      }
      // The owner's declared schedule is still law on the new dates.
      const boothSnap = await db.doc(`tenants/${tenantId}/booths/${r.boothId}`).get();
      const booth = boothSnap.exists ? (boothSnap.data() as any) : {};
      const schedDays: number[] | undefined = Array.isArray(booth.dayRentalDays) ? booth.dayRentalDays : undefined;
      const blackouts: string[] = Array.isArray(booth.blackoutDates) ? booth.blackoutDates : [];
      for (let t = new Date(startDate + 'T00:00:00Z').getTime(), e = new Date(endDate + 'T00:00:00Z').getTime(); t <= e; t += DAY_MS) {
        const iso = new Date(t).toISOString().slice(0, 10);
        const dow = new Date(t).getUTCDay();
        if (schedDays && schedDays.length > 0 && !schedDays.includes(dow)) {
          return NextResponse.json({ ok: false, error: `This space isn't available on ${iso}.` }, { status: 400 });
        }
        if (blackouts.includes(iso)) {
          return NextResponse.json({ ok: false, error: `${iso} is unavailable.` }, { status: 400 });
        }
      }
      if (isHourly) {
        const openT = booth.openTime || '00:00';
        const closeT = booth.closeTime || '23:59';
        if ((startTime as string) < openT || (endTime as string) > closeT) {
          return NextResponse.json({ ok: false, error: `Hourly bookings are available ${openT} – ${closeT}.` }, { status: 400 });
        }
      }
      const proposed = { startDate, endDate, bookingType: r.bookingType, startTime: startTime || undefined, endTime: endTime || undefined };
      if (await findConflict(db, tenantId, r.boothId, proposed, reservationId)) {
        return NextResponse.json({ ok: false, error: 'That time is already booked — pick another.' }, { status: 409 });
      }
      const slotClash = await leaseSlotConflict(db, tenantId, r.boothId, proposed);
      if (slotClash) {
        return NextResponse.json({ ok: false, error: `That time isn't available — ${slotClash}.` }, { status: 409 });
      }
      const nowIso = new Date().toISOString();
      const prev = { startDate: r.startDate, endDate: r.endDate, startTime: r.startTime || null, endTime: r.endTime || null };
      await resRef.set({
        startDate, endDate,
        startTime: startTime || null, endTime: endTime || null,
        numDays: newDays,
        rescheduledAt: nowIso,
        rescheduleCount: (r.rescheduleCount || 0) + 1,
        prevSchedule: prev,
        rescheduleRequestedAt: null,
        rescheduleRequestNote: null,
      }, { merge: true });
      const fmt = (d: string, s?: string | null, e2?: string | null) => (s ? `${d} ${s}–${e2}` : d);
      await logAuditAdmin(db, tenantId, {
        action: 'booth.rescheduled', targetType: 'boothReservation', targetId: reservationId,
        summary: `${r.name || 'Guest'}'s ${r.boothName || 'space'} booking moved: ${fmt(prev.startDate, prev.startTime, prev.endTime)} → ${fmt(startDate, startTime, endTime)}`,
        before: prev, after: { startDate, endDate, startTime, endTime },
        actor: { type: 'user', name: body.actorName || 'Owner', via: 'booths-page' },
      });
      const nRef = db.collection(`tenants/${tenantId}/notifications`).doc();
      await nRef.set({
        id: nRef.id, userId: null, read: false, createdAt: nowIso,
        type: 'booth_reservation', link: '/pos?tab=spaces',
        message: `${r.name || 'A guest'}'s booking moved to ${fmt(startDate, startTime, endTime)} (${r.boothName || 'space'}).`,
      });
      return NextResponse.json({ ok: true, startDate, endDate, startTime, endTime });
    }

    if (r.status === 'refunded') {
      // Idempotent: repeat calls succeed without double-refunding.
      return NextResponse.json({ ok: true, refundedCents: r.refundedCents || 0, alreadyRefunded: true });
    }
    const REFUNDABLE = ['confirmed', 'checked_in', 'completed', 'cancel_requested', 'cancelled_refund_pending', 'payment_received_conflict'];
    if (!REFUNDABLE.includes(r.status)) {
      return NextResponse.json({ ok: false, error: `A ${String(r.status).replace(/_/g, ' ')} reservation can't be refunded.` }, { status: 400 });
    }
    if (!r.stripePaymentIntentId) {
      return NextResponse.json({ ok: false, error: 'No Stripe payment on this reservation — record the refund manually in the ledger.' }, { status: 400 });
    }
    const paidCents = Number(r.amountCents) || 0;
    const requested = Number(body.amountCents) || paidCents;
    const refundCents = Math.min(Math.max(0, Math.round(requested)), paidCents);
    if (refundCents <= 0) return NextResponse.json({ ok: false, error: 'Nothing to refund.' }, { status: 400 });

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
    let refund;
    try {
      refund = await stripe.refunds.create({
        payment_intent: r.stripePaymentIntentId,
        amount: refundCents,
        metadata: { tenantId, reservationId, kind: 'booth_refund' },
      });
    } catch (err: any) {
      const msg = err?.raw?.message || err?.message || 'Refund failed.';
      return NextResponse.json({ ok: false, error: `Stripe refund failed: ${msg}` }, { status: 402 });
    }

    const nowIso = new Date().toISOString();
    const txnRef = db.collection(`tenants/${tenantId}/transactions`).doc();
    await txnRef.set({
      id: txnRef.id, type: 'reversal', context: 'Business', taxBucket: 'refund',
      source: 'booth_rent',
      amount: refundCents / 100, category: 'Refunds',
      description: `Refund — ${r.boothName || 'Space'} — ${r.name || 'guest'}${reason ? ` (${String(reason).slice(0, 120)})` : ''}`,
      clientOrVendor: r.name || 'Day renter', date: nowIso, paymentMethod: 'Card (Stripe refund)',
      hasReceipt: false, stripePaymentIntentId: r.stripePaymentIntentId, stripeRefundId: refund.id,
      sourceId: reservationId, tenantId, createdAt: nowIso,
    });
    await resRef.set({
      status: 'refunded', refundedAt: nowIso,
      refundedCents: refundCents, stripeRefundId: refund.id,
      refundReason: reason ? String(reason).slice(0, 300) : null,
    }, { merge: true });

    const actor = (body?.actor && body.actor.type === 'user')
      ? { type: 'user' as const, id: body.actor.id || undefined, name: body.actor.name || undefined, role: body.actor.role || undefined }
      : { type: 'user' as const };
    await logAuditAdmin(db, tenantId, {
      action: 'booth.refunded', targetType: 'boothReservation', targetId: reservationId,
      summary: `Refunded ${refundCents === paidCents ? 'in full' : `$${(refundCents / 100).toFixed(2)} of $${(paidCents / 100).toFixed(2)}`}: ${r.name || 'guest'} · ${r.boothName || 'space'}${reason ? ` — ${String(reason).slice(0, 80)}` : ''} · Stripe ${refund.id}`,
      amount: refundCents / 100, actor,
    });

    return NextResponse.json({ ok: true, refundedCents: refundCents, stripeRefundId: refund.id });
  } catch (err) {
    console.error('[booth-reserve] PATCH failed', err);
    return NextResponse.json({ ok: false, error: 'Could not process refund.' }, { status: 500 });
  }
}
