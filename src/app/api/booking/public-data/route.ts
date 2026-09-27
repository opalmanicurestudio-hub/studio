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
// The availability engine (src/lib/availability.ts) is the same one the
// booking route uses to verify, so the page and the server still agree.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { tenantTimeZone, todayIn } from '@/lib/tenant-time';

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
  const tSnap = await db.doc(T).get();
  if (!tSnap.exists) return NextResponse.json({ ok: false, error: 'Unknown business.' }, { status: 404 });
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
  const studioEvents = rows(se, (x) => drop(x, GENERAL_DROP)).sort((a: any, c: any) => String(a.date || '').localeCompare(String(c.date || '')));
  return NextResponse.json({
    ok: true, fromDay, eventsFromDay,
    services: rows(sv, (x) => x), consentForms: rows(cf, (x) => x), resources: rows(rs, (x) => x), renterServices: rows(rsv, (x) => x),
    staff: rows(st, (x) => drop(x, STAFF_DROP)),
    appointments: rows(ap, (x) => keep(x, APPT_KEEP)),
    studioEvents, scheduleProfiles: rows(sp, (x) => drop(x, GENERAL_DROP)), pricingTiers: rows(pt, (x) => drop(x, GENERAL_DROP)),
    shifts: rows(sh, (x) => drop(x, GENERAL_DROP)), staffBlocks: rows(sb, (x) => drop(x, GENERAL_DROP)), dayOffBlocks: rows(dof, (x) => drop(x, GENERAL_DROP)),
    tickets: rows(tk, (x) => drop(x, GENERAL_DROP)), maintenancePlans: rows(mp, (x) => drop(x, GENERAL_DROP)), events: rows(ce, (x) => drop(x, GENERAL_DROP)),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
