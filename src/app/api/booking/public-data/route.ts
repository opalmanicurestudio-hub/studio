// src/app/api/booking/public-data/route.ts
//
// EVERYTHING THE PUBLIC BOOKING PAGE NEEDS — loaded on the server.
//
// Why: the booking page used to read these collections straight from the
// visitor's browser. The database rules (correctly) only let STAFF read the
// team list, appointments, shifts, days off, events and tickets — so for a
// real client who isn't signed in, the page's load failed and no services or
// providers appeared. Signed-in staff saw a working page, which hid it.
//
// This route reads the same data with admin access and returns only what a
// visitor may see:
//   • services, consent forms, resources, renter menus — public by design
//   • the team — everything the page shows, minus PINs, phone, email, pay,
//     bank, tax, notes and other private fields
//   • appointments — scheduling fields ONLY (times, provider, service,
//     status, holds, resources). No client names, phones, emails or notes.
//   • shifts, blocks, days off, calendar events, maintenance — times and
//     resources only; reasons, descriptions and people's details removed
// OPEN TIMES are worked out HERE (action 'availability'), with the same
// availability engine the booking route uses to verify — so busy times
// (appointments, shifts, days off, blocks, maintenance) never leave the
// server at all. The page receives only "these times are open".
// 'pick' chooses the provider for "Any available" the same way.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { tenantTimeZone, todayIn } from '@/lib/tenant-time';
import { computeAvailability, pickStaffForSlot } from '@/lib/availability';

export const dynamic = 'force-dynamic';

// Appointments: exactly the scheduling fields the availability engine reads.
const APPT_KEEP = ['staffId', 'staffIds', 'staffName', 'serviceId', 'serviceIds', 'serviceName', 'addOnIds', 'startTime', 'endTime', 'duration', 'status',
  'padBefore', 'padAfter', 'paymentDueAt', 'requestExpiresAt', 'requiredResourceIds', 'resourceId', 'resourceIds', 'stationId', 'createdAt', 'price',
  'type', 'isBlock', 'tierId', 'pricingTierId', 'isRenterBooking', 'capacity', 'guestCount'];
// Team: remove anything private (keep name, photo, bio, services, hours, flags).
const STAFF_DROP = /^(pin|pinHash|pinSalt|phone|mobile|email|personalEmail|address|homeAddress|dob|birth|ssn|tax|taxId|ein|w9|bank|routing|account(Number)?$|payRate|hourlyRate|salary|wage|commission|compensation|payStructure|payroll|tipPolicy|emergency|notes?$|privateNotes|internalNotes|stripeAccountId|stripeCustomerId|userId|authUid|deviceToken|fcmToken|pushToken|invite|temporaryPassword|password|secret|token)/i;
// Everything else (shifts, blocks, events, tickets): drop people's details and free text.
const GENERAL_DROP = /^(client|customer|guestName|guestEmail|guestPhone|contact|email|phone|mobile|note|notes|reason|description|details|comment|message|reporter|reportedBy|createdBy|updatedBy|approvedBy|requestedBy|assignee|assignedTo(Name)?|photo|photos|attachments|address|card|stripe|payment(Intent|Method)|tip|consent|signature|medical|health|allerg|emergency|pin|token|secret|password|ip$|userAgent|history|messages)/i;

const keep = (o: any, list: string[]) => { const out: any = {}; for (const k of list) if (o[k] !== undefined) out[k] = o[k]; return out; };
const drop = (o: any, re: RegExp) => { const out: any = {}; for (const [k, v] of Object.entries(o || {})) if (!re.test(k)) out[k] = v; return out; };
const rows = (snap: any, map: (d: any) => any) => (snap?.docs || []).map((d: any) => ({ id: d.id, ...map(d.data() || {}) }));

const FALLBACK_HOURS = { start: '08:00', end: '20:00' }; // same default as the browser hook (useSmartAvailability)

async function loadAll(db: any, T: string) {
  const tSnap = await db.doc(T).get();
  if (!tSnap.exists) return null;
  const t = tSnap.data() as any;
  const tz = tenantTimeZone(t);
  const fromDay = todayIn(tz), eventsFromDay = todayIn(tz, new Date(Date.now() - 31 * 86400000));
  const safe = async (p: Promise<any>) => { try { return await p; } catch { return { docs: [] }; } };
  const [sv, st, se, ap, sp, pt, cf, sh, sb, dof, rs, tk, mp, ce, rsv] = await Promise.all([
    safe(db.collection(`${T}/services`).get()),
    safe(db.collection(`${T}/staff`).get()),
    safe(db.collection(`${T}/studioEvents`).get()),
    safe(db.collection(`${T}/appointments`).where('startTime', '>=', fromDay).get()),
    safe(db.collection(`${T}/scheduleProfiles`).get()),
    safe(db.collection(`${T}/pricingTiers`).get()),
    safe(db.collection(`${T}/consentForms`).get()),
    safe(db.collection(`${T}/shifts`).where('date', '>=', fromDay).get()),
    safe(db.collection(`${T}/staffBlocks`).where('startTime', '>=', fromDay).get()),
    safe(db.collection(`${T}/shiftDayOffBlocks`).where('date', '>=', fromDay).get()),
    safe(db.collection(`${T}/resources`).get()),
    safe(db.collection(`${T}/tickets`).where('status', 'in', ['open', 'in_progress']).get()),
    safe(db.collection(`${T}/maintenancePlans`).get()),
    safe(db.collection(`${T}/events`).where('startTime', '>=', eventsFromDay).get()),
    safe(db.collection(`${T}/renterServices`).get()),
  ]);
  return { t, fromDay, eventsFromDay, sv, st, se, ap, sp, pt, cf, sh, sb, dof, rs, tk, mp, ce, rsv };
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId)) return NextResponse.json({ ok: false, error: 'Unknown business.' }, { status: 400 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  // A renter's "I'm a member" check: answers yes/no only — never anyone's details.
  if (b.action === 'renter-member') {
    const providerId = String(b.providerId || ''), email = String(b.email || '').trim().toLowerCase();
    if (!providerId || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ ok: true, member: false });
    const q = await db.collection(`${T}/renterMemberSubscriptions`).where('staffId', '==', providerId).where('clientEmail', '==', email).limit(5).get().catch(() => ({ docs: [] as any[] }));
    return NextResponse.json({ ok: true, member: q.docs.some((d: any) => (d.data() as any)?.status === 'active') }, { headers: { 'Cache-Control': 'no-store' } });
  }
  // A renter's packages and memberships for their personal booking link (public product info).
  if (b.action === 'renter-products') {
    const providerId = String(b.providerId || ''); if (!providerId) return NextResponse.json({ ok: true, packages: [], memberships: [] });
    const [ps, ms] = await Promise.all([db.collection(`${T}/renterPackages`).where('staffId', '==', providerId).get().catch(() => ({ docs: [] })), db.collection(`${T}/renterMemberships`).where('staffId', '==', providerId).get().catch(() => ({ docs: [] }))]);
    return NextResponse.json({ ok: true, packages: rows(ps, (x) => drop(x, GENERAL_DROP)), memberships: rows(ms, (x) => drop(x, GENERAL_DROP)) }, { headers: { 'Cache-Control': 'no-store' } });
  }
  const loaded = await loadAll(db, T);
  if (!loaded) return NextResponse.json({ ok: false, error: 'Unknown business.' }, { status: 404 });
  const { t, fromDay, eventsFromDay, sv, st, se, ap, sp, pt, cf, sh, sb, dof, rs, tk, mp, ce, rsv } = loaded;

  // ── Open times for one day (and the provider for "Any available") ──
  if (b.action === 'availability' || b.action === 'pick') {
    const date = String(b.date || ''), serviceId = String(b.serviceId || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !serviceId) return NextResponse.json({ ok: false, error: 'Pick a service and a day.' }, { status: 400 });
    const raw = (snap: any) => (snap?.docs || []).map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
    const everyStaff = raw(st).filter((m: any) => m.isActive !== false);
    const bookable = everyStaff.filter((m: any) => !(m.isRenter && m.bookingOptOut === true));
    const providerId = String(b.providerId || '');
    const provider = providerId ? bookable.find((m: any) => m.id === providerId && m.isRenter) : null;
    // Same service list the page shows: a renter's own menu on their link, else the house menu.
    const services = provider
      ? raw(rsv).filter((x: any) => x.isActive !== false && x.staffId === provider.id).map((x: any) => ({ ...x, staffIds: [provider.id] }))
      : raw(sv).filter((x: any) => x.isActive !== false);
    const service = services.find((x: any) => x.id === serviceId);
    if (!service) return NextResponse.json({ ok: false, error: 'That service isn’t available.' }, { status: 404 });
    const pool = provider ? [provider] : bookable;
    const qualified = !service.requiredSkills?.length ? pool : pool.filter((m: any) => service.requiredSkills.every((k: string) => (m.skillSet || []).includes(k)));
    const staffId = String(b.staffId || 'any'), tierId = b.tierId ? String(b.tierId) : undefined;
    const input: any = {
      date, serviceId, staffId, tierId: staffId === 'any' ? tierId : undefined, addOnIds: Array.isArray(b.addOnIds) ? b.addOnIds.map(String).slice(0, 20) : [],
      services, staff: qualified, appointments: raw(ap), events: raw(ce), scheduleProfiles: raw(sp), tenant: { id: tenantId, ...t },
      shifts: raw(sh), staffBlocks: raw(sb), dayOffBlocks: raw(dof), resources: raw(rs), tickets: raw(tk), maintenancePlans: raw(mp),
      fallbackHours: FALLBACK_HOURS, includeUnavailable: false,
    };
    try {
      if (b.action === 'pick') {
        const pick: any = pickStaffForSlot({ ...input, time: String(b.time || ''), staffId: 'any' });
        return NextResponse.json(pick?.ok ? { ok: true, staffId: pick.staffId || pick.staff?.id || null } : { ok: false, error: pick?.error || 'No professionals are available for this time. Please pick another.' }, { headers: { 'Cache-Control': 'no-store' } });
      }
      const r = computeAvailability(input);
      // Only what the page shows: open times, freshly freed times, add-on fits.
      return NextResponse.json({ ok: true, times: r.times, hotTimes: r.hotTimes, addOnUpsells: r.addOnUpsells, bestGapMinutes: r.bestGapMinutes, warnings: r.warnings,
        staffByTime: Object.fromEntries(Object.entries(r.byTime || {}).map(([k, v]: any) => [k, (v || []).map((x: any) => x.staffId)])) }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (e: any) {
      console.error('[booking:availability]', e);
      return NextResponse.json({ ok: true, times: [], hotTimes: [], addOnUpsells: [], bestGapMinutes: 0, staffByTime: {}, warnings: ['Availability could not be calculated. Please refresh and try again.'] });
    }
  }

  const studioEvents = rows(se, (x) => drop(x, GENERAL_DROP)).sort((a: any, c: any) => String(a.date || '').localeCompare(String(c.date || '')));
  void ap; void sh; void sb; void dof; void tk; void mp; void ce; void sp; // busy data: used only by 'availability' above, never sent
  return NextResponse.json({
    ok: true, fromDay, eventsFromDay,
    services: rows(sv, (x) => x), consentForms: rows(cf, (x) => x), resources: rows(rs, (x) => x), renterServices: rows(rsv, (x) => x),
    staff: rows(st, (x) => drop(x, STAFF_DROP)),
    studioEvents, pricingTiers: rows(pt, (x) => drop(x, GENERAL_DROP)),
    // Busy times are no longer sent — open times come from action 'availability'.
    appointments: [], scheduleProfiles: [], shifts: [], staffBlocks: [], dayOffBlocks: [], tickets: [], maintenancePlans: [], events: [],
  }, { headers: { 'Cache-Control': 'no-store' } });
}
