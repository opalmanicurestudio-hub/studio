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
import { computeAvailability, pickStaffForSlot, isCertified } from '@/lib/availability';
import { horizonDaysFor } from '@/lib/booking-release';
import { loadBookingData, FALLBACK_HOURS, engineFrame } from '@/lib/booking-data';
import { maybeReleaseUnpaid } from '@/lib/release-unpaid';
import { addDays as addDaysStr } from '@/lib/tenant-time';
import { limitPublic, visitorIp } from '@/lib/rate-limit';
import { publicEvent, listedEvent, listedTicketPrice, eventCapacity, eventToday } from '@/lib/studio-page';
import { heldPlaces } from '@/lib/event-tickets';
import { resolveOffers, offerAllows } from '@/lib/renter-offers';

export const dynamic = 'force-dynamic';

// Appointments: exactly the scheduling fields the availability engine reads.
const APPT_KEEP = ['staffId', 'staffIds', 'staffName', 'serviceId', 'serviceIds', 'serviceName', 'addOnIds', 'startTime', 'endTime', 'duration', 'status',
  'padBefore', 'padAfter', 'paymentDueAt', 'requestExpiresAt', 'requiredResourceIds', 'resourceId', 'resourceIds', 'stationId', 'createdAt', 'price',
  'type', 'isBlock', 'tierId', 'pricingTierId', 'isRenterBooking', 'capacity', 'guestCount'];
// Team: remove anything private (keep name, photo, bio, services, hours, flags).
const STAFF_DROP = /^(pin|pinHash|pinSalt|phone|mobile|email|personalEmail|address|homeAddress|dob|birth|ssn|tax|taxId|ein|w9|bank|routing|account(Number)?$|payRate|hourlyRate|salary|wage|commission|compensation|payStructure|payroll|tipPolicy|emergency|notes?$|privateNotes|internalNotes|stripeAccountId|stripeCustomerId|userId|authUid|deviceToken|fcmToken|pushToken|invite|temporaryPassword|password|secret|token)/i;
// Everything else (shifts, blocks, events, tickets): drop people's details and free text.
const GENERAL_DROP = /^(client|customer|guestName|guestEmail|guestPhone|contact|email|phone|mobile|note|notes|reason|description|details|comment|message|reporter|reportedBy|createdBy|updatedBy|approvedBy|requestedBy|assignee|assignedTo(Name)?|photo|photos|attachments|address|card|stripe|payment(Intent|Method)|tip|consent|signature|medical|health|allerg|emergency|pin|token|secret|password|ip$|userAgent|history|messages)/i;

/** What the booking page shows of a public event, and nothing else. */
const publicEventFields = (e: any) => ({ ...keep(e, ['id', 'title', 'name', 'date', 'time', 'endTime', 'status', 'venue', 'capacity', 'showOnBookingPage']), ticketPrice: listedTicketPrice(e),
  ...(e.ticketingConfig ? { ticketingConfig: keep(e.ticketingConfig, ['price', 'capacity', 'type']) } : {}) });
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
    // Not theirs to sell here right now (off, or an add-on they don't have: lib/renter-offers): nothing listed.
    { const st: any = (await db.doc(`${T}/staff/${providerId.slice(0, 120)}`).get().catch(() => null))?.data?.() || null;
      const r: any = st?.renterId ? (await db.doc(`${T}/renters/${String(st.renterId)}`).get().catch(() => null))?.data?.() || null : null;
      if (st?.renterId && !offerAllows(resolveOffers((await db.doc(T).get()).data()), 'packages', r)) return NextResponse.json({ ok: true, packages: [], memberships: [] }, { headers: { 'Cache-Control': 'no-store' } }); }
    const [ps, ms] = await Promise.all([db.collection(`${T}/renterPackages`).where('staffId', '==', providerId).get().catch(() => ({ docs: [] })), db.collection(`${T}/renterMemberships`).where('staffId', '==', providerId).get().catch(() => ({ docs: [] }))]);
    return NextResponse.json({ ok: true, packages: rows(ps, (x) => drop(x, GENERAL_DROP)), memberships: rows(ms, (x) => drop(x, GENERAL_DROP)) }, { headers: { 'Cache-Control': 'no-store' } });
  }
  // Seats left at the business's public events, for the booking page: counts only, never who is coming. The guest
  // list is the one the business keeps for the event (reservations from the page land on it too).
  if (b.action === 'event-seats') {
    const limited = await limitPublic(req, 'event-seats', tenantId, { perHour: 600, perDay: 6000 }); if (limited) return limited;
    const ids: string[] = (Array.isArray(b.ids) ? b.ids : []).map((x: any) => String(x || '')).filter((x: string) => /^[A-Za-z0-9_-]{1,80}$/.test(x)).slice(0, 8);
    const seats: Record<string, number> = {};
    await Promise.all(ids.map(async (id) => {
      try {
        const ev: any = (await db.doc(`${T}/studioEvents/${id}`).get()).data(); if (!listedEvent(ev)) return;
        const cap = eventCapacity(ev); if (cap <= 0) return;
        const n = (await db.collection(`${T}/eventGuests`).where('eventId', '==', id).count().get()).data().count;
        // A paid event's places held by guests paying right now count as taken (lib/event-tickets).
        const held = listedTicketPrice(ev) > 0 ? heldPlaces((await db.collection(`${T}/eventTicketOrders`).where('eventId', '==', id).get()).docs.map((d: any) => d.data() || {})) : 0;
        seats[id] = Math.max(0, cap - n - held);
      } catch (e: any) { console.error('[booking:event-seats]', e?.message || e); }
    }));
    return NextResponse.json({ ok: true, seats }, { headers: { 'Cache-Control': 'no-store' } });
  }
  // A place at a public event, reserved from the booking page: added to the event's guest list (what the business sees
  // in the event), never past its limit, once per email.
  if (b.action === 'event-reserve') {
    const eventId = String(b.eventId || '');
    const name = String(b.name || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const email = String(b.email || '').trim().toLowerCase().slice(0, 160); const phone = String(b.phone || '').trim().slice(0, 40);
    const places = Math.max(1, Math.min(4, Math.floor(Number(b.places) || 1)));
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(eventId) || !name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ ok: false, error: 'Add your name and email.' }, { status: 400 });
    // A form field people never see: filled in means a script. It's told the same as anyone, and nothing is written.
    if (String(b.rsv_ref || '').trim()) { console.warn('[booking:event-reserve] trap field filled', tenantId, eventId); return NextResponse.json({ ok: true, title: 'the event' }, { headers: { 'Cache-Control': 'no-store' } }); }
    const limited = await limitPublic(req, 'event-reserve', tenantId, { perHour: 10, perDay: 1000 }); if (limited) return limited;
    // And from any one visitor, at most two reservations made for the same event a day, so no one can fill a class
    // alone: counted inside the reservation itself (so a burst can't slip past), and only for reservations that went
    // through (a "full" or "only 2 left" answer doesn't use a try up).
    const { createHash } = await import('crypto');
    const capRef = db.collection('rateLimits').doc(`event-rsv_${createHash('sha256').update(`${tenantId}|${eventId}|${visitorIp(req)}`).digest('hex').slice(0, 32)}_${Math.floor(Date.now() / 86400000)}`);
    const tSnap = await db.doc(T).get(); const tt: any = tSnap.data(); if (!tt) return NextResponse.json({ ok: false, error: 'Unknown business.' }, { status: 404 });
    const evRef = db.doc(`${T}/studioEvents/${eventId}`); const guests = db.collection(`${T}/eventGuests`);
    try {
      const r = await db.runTransaction(async (tx: any) => {
        const ev: any = (await tx.get(evRef)).data();
        const made = Number(((await tx.get(capRef)).data() as any)?.count) || 0;
        if (!publicEvent(ev) || String(ev.date) < eventToday(tt)) return { ok: false, error: 'That event isn’t taking reservations.' };
        const list = (await tx.get(guests.where('eventId', '==', eventId))).docs.map((d: any) => d.data() || {});
        const cap = eventCapacity(ev); const left = cap > 0 ? cap - list.length : Infinity;
        // Already on the list: told the same as a new reservation (nobody can test who's coming), nothing added.
        if (list.some((g: any) => String(g.email || '').toLowerCase() === email)) return { ok: true, already: true, title: ev.title || ev.name || 'the event' };
        if (left <= 0) return { ok: false, error: 'That event is full.', full: true };
        if (places > left) return { ok: false, error: `Only ${left} ${left === 1 ? 'place is' : 'places are'} left.`, left };
        if (made >= 2) return { ok: false, error: 'Too many reservations for this event from here today. To add more, contact the business.', capped: true };
        const now = new Date().toISOString();
        for (let i = 0; i < places; i++) { const g = guests.doc();
          tx.set(g, { id: g.id, eventId, tenantId, name: i === 0 ? name : `${name} (guest ${i})`, email: i === 0 ? email : '', phone: i === 0 ? phone : '', tableId: null, tableNumber: null, seatNumber: null,
            notes: '', allergies: [], dietaryRestrictions: [], checkedIn: false, source: 'booking page', submittedAt: now }); }
        tx.set(evRef, { rsvpCount: (Number(ev.rsvpCount) || 0) + places }, { merge: true });
        tx.set(capRef, { count: made + 1, expiresAt: new Date(Date.now() + 2 * 86400000) }, { merge: true });
        return { ok: true, title: ev.title || ev.name || 'the event' };
      });
      if (r.ok && !(r as any).already && tt.userId) await db.collection(`${T}/notifications`).add({ userId: String(tt.userId), type: 'event_reservation', message: `${name} reserved ${places === 1 ? 'a place' : `${places} places`} at ${(r as any).title} from your booking page.`, link: `/events/${eventId}/manifest`, read: false, createdAt: new Date().toISOString() }).catch(() => undefined);
      const { already, capped, ...out } = r as any; void already;
      return NextResponse.json(out, { status: r.ok ? 200 : capped ? 429 : 409, headers: { 'Cache-Control': 'no-store' } });
    } catch (e: any) { console.error('[booking:event-reserve]', e?.message || e); return NextResponse.json({ ok: false, error: 'That didn’t go through. Try again in a moment.' }, { status: 500 }); }
  }
  const loaded = await loadBookingData(db, T, { exceptHoldId: typeof b?.holdId === 'string' ? b.holdId.slice(0, 40) : null });   // the client's own held time stays open to them
  if (!loaded) return NextResponse.json({ ok: false, error: 'Unknown business.' }, { status: 404 });
  const { t, fromDay, eventsFromDay, sv, st, se, ap, sp, pt, cf, sh, sb, dof, rs, tk, mp, ce, rsv } = loaded;

  // ── Open times for one day (and the provider for "Any available") ──
  // The soonest open time for each of the page's services (and for a few service + person pairs: "Book again with
  // Maya", "Next opening" on the team), over the next two weeks. Times only, never who is booked.
  if (b.action === 'soonest') {
    const limited = await limitPublic(req, 'soonest', tenantId, { perHour: 300, perDay: 3000 }); if (limited) return limited;
    const raw = (snap: any) => (snap?.docs || []).map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
    const bookable = raw(st).filter((m: any) => m.isActive !== false && !(m.isRenter && m.bookingOptOut === true));
    const services = raw(sv).filter((x: any) => x.isActive !== false);
    const busy = { appointments: raw(ap), events: raw(ce), staffBlocks: raw(sb), tickets: raw(tk) };
    const rest = { scheduleProfiles: raw(sp), shifts: raw(sh), dayOffBlocks: raw(dof), resources: raw(rs), maintenancePlans: raw(mp) };
    // The pairs first (Book again, the team), then the services.
    const asks: { key: string; serviceId: string; staffId: string }[] = [];
    for (const p of (Array.isArray(b.pairs) ? b.pairs : []).slice(0, 6)) { const sid = String(p?.serviceId || ''), mid = String(p?.staffId || ''); if (/^[A-Za-z0-9_-]{1,80}$/.test(sid) && /^[A-Za-z0-9_-]{1,80}$/.test(mid)) asks.push({ key: `${sid}|${mid}`, serviceId: sid, staffId: mid }); }
    for (const id of (Array.isArray(b.serviceIds) ? b.serviceIds : []).map(String).filter((x: string) => /^[A-Za-z0-9_-]{1,80}$/.test(x)).slice(0, 12)) asks.push({ key: id, serviceId: id, staffId: 'any' });
    const tz = tenantTimeZone(t); const today = todayIn(tz);
    // Never past what clients can book: the business's own booking window (members aside) as well as the engine's limits.
    const horizon = horizonDaysFor(t.bookingRelease || null, false, new Date(), tz);
    const days = Math.max(1, Math.min(14, horizon === null ? 14 : horizon + 1));
    const frames = new Map<string, any>(); const frame = (date: string) => { if (!frames.has(date)) frames.set(date, engineFrame(busy, tz, date)); return frames.get(date); };
    const out: Record<string, { date: string; time: string; label: string }> = {};
    // Only what someone could book: a service that exists, with someone who can do it.
    const live = asks.filter((a, i) => asks.findIndex((x) => x.key === a.key) === i).map((a) => {
      const service = services.find((x: any) => x.id === a.serviceId); if (!service) return null;
      const pool = a.staffId === 'any' ? bookable : bookable.filter((m: any) => m.id === a.staffId);
      const qualified = pool.filter((m: any) => (service.requiredSkills || []).every((k: string) => (m.skillSet || []).includes(k)) && isCertified(service, m.id));
      return qualified.length ? { ...a, qualified } : null;
    }).filter(Boolean) as (typeof asks[number] & { qualified: any[] })[];
    // Day by day across every ask still without an answer, with one ceiling on the work for the whole request (a number
    // of looks and a time limit): an ask answered today stops costing anything, and a day nobody works costs next to
    // nothing, so a busy studio, or one that opens later in the week, still gets its times.
    // The looks are the ceiling; the time is only a safety valve.
    let budget = 260; const until = Date.now() + 1500; const done = new Set<string>();
    for (let i = 0; i < days && budget > 0 && done.size < live.length && Date.now() < until; i++) {
      const date = addDaysStr(today, i);
      for (const a of live) {
        if (done.has(a.key)) continue; if (budget <= 0 || Date.now() >= until) break; budget--;
        try {
          const f = frame(date);
          const r = computeAvailability({ date, serviceId: a.serviceId, staffId: a.staffId, addOnIds: [], services, staff: a.qualified, tenant: { id: tenantId, ...t }, ...rest,
            appointments: f.appointments, events: f.events, staffBlocks: f.staffBlocks, tickets: f.tickets, now: f.now, fallbackHours: FALLBACK_HOURS, includeUnavailable: false,
            ...(horizon !== null ? { maxHorizonDays: horizon } : {}) } as any);
          const first = r.slots?.[0];
          if (first) { out[a.key] = { date, time: first.time, label: first.label }; done.add(a.key); }
        } catch { done.add(a.key); }   // a service the engine can't work out: given up on, not retried every day
      }
    }
    return NextResponse.json({ ok: true, today, soonest: out }, { headers: { 'Cache-Control': 'no-store' } });
  }
  if (b.action === 'availability' || b.action === 'pick' || b.action === 'days') {
    const date = String(b.date || b.from || ''), serviceId = String(b.serviceId || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !serviceId) return NextResponse.json({ ok: false, error: 'Pick a service and a day.' }, { status: 400 });
    const raw = (snap: any) => (snap?.docs || []).map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
    const everyStaff = raw(st).filter((m: any) => m.isActive !== false);
    const bookable = everyStaff.filter((m: any) => !(m.isRenter && m.bookingOptOut === true));
    const providerId = String(b.providerId || '');
    const provider = providerId ? bookable.find((m: any) => m.id === providerId && m.isRenter) : null;
    // Same service list the page shows: a renter's own menu on their link, else the house menu.
    const listed = provider
      ? raw(rsv).filter((x: any) => x.isActive !== false && x.staffId === provider.id).map((x: any) => ({ ...x, staffIds: [provider.id] }))
      : raw(sv).filter((x: any) => x.isActive !== false);
    // A returning client's usual extra time (0–240 min): only ever makes the visit LONGER, so it can only remove times.
    const extraMinutes = Math.max(0, Math.min(240, Math.round(Number(b.extraMinutes) || 0)));
    const services = extraMinutes ? listed.map((x: any) => (x.id === serviceId ? { ...x, duration: (Number(x.duration) || 60) + extraMinutes } : x)) : listed;
    const service = services.find((x: any) => x.id === serviceId);
    if (!service) return NextResponse.json({ ok: false, error: 'That service isn’t available.' }, { status: 404 });
    const pool = provider ? [provider] : bookable;
    const qualified = !service.requiredSkills?.length ? pool : pool.filter((m: any) => service.requiredSkills.every((k: string) => (m.skillSet || []).includes(k)));
    const staffId = String(b.staffId || 'any'), tierId = b.tierId ? String(b.tierId) : undefined;
    const input: any = {
      date, serviceId, staffId, tierId: staffId === 'any' ? tierId : undefined, addOnIds: Array.isArray(b.addOnIds) ? b.addOnIds.map(String).slice(0, 20) : [],
      services, staff: qualified, scheduleProfiles: raw(sp), tenant: { id: tenantId, ...t },
      // Busy times moved into the business's local frame, exactly like the booking check.
      ...(() => { const f = engineFrame({ appointments: raw(ap), events: raw(ce), staffBlocks: raw(sb), tickets: raw(tk) }, tenantTimeZone(t), date); return { appointments: f.appointments, events: f.events, staffBlocks: f.staffBlocks, tickets: f.tickets, now: f.now }; })(),
      shifts: raw(sh), dayOffBlocks: raw(dof), resources: raw(rs), maintenancePlans: raw(mp),
      fallbackHours: FALLBACK_HOURS, includeUnavailable: false,
    };
    try {
      // 'days' — HOW MANY open times each day has (up to 6 weeks), for the
      // calendar's availability dots. Counts only — never who is booked.
      if (b.action === 'days') {
        // The heaviest ask (up to six weeks worked out at once): limited per visitor and per business.
        const limited = await limitPublic(req, 'days', tenantId, { perHour: 240, perDay: 20000 }); if (limited) return limited;
        const n = Math.max(1, Math.min(42, Number(b.days) || 31)); const tz = tenantTimeZone(t);
        const out: { date: string; count: number }[] = [];
        for (let i = 0; i < n; i++) {
          const d = addDaysStr(date, i);
          const f = engineFrame({ appointments: raw(ap), events: raw(ce), staffBlocks: raw(sb), tickets: raw(tk) }, tz, d);
          let count = 0; try { count = computeAvailability({ ...input, date: d, appointments: f.appointments, events: f.events, staffBlocks: f.staffBlocks, tickets: f.tickets, now: f.now }).times.length; } catch { /* day unreadable → 0 */ }
          out.push({ date: d, count });
        }
        return NextResponse.json({ ok: true, days: out }, { headers: { 'Cache-Control': 'no-store' } });
      }
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

  // Payment deadlines, enforced while the page is busy (at most every 10 min per business).
  await maybeReleaseUnpaid(db, tenantId, req.nextUrl.origin);
  // Only the events the owner put on the booking page, and only what the page shows of them: never a private party,
  // a quote's event, its PIN, costs, guests or seating.
  const studioEvents = rows(se, (x) => x).filter(listedEvent).map(publicEventFields).sort((a: any, c: any) => String(a.date || '').localeCompare(String(c.date || '')));
  void ap; void sh; void sb; void dof; void tk; void mp; void ce; void sp; // busy data: used only by 'availability' above, never sent
  return NextResponse.json({
    ok: true, fromDay, eventsFromDay,
    services: rows(sv, (x) => x), consentForms: rows(cf, (x) => x), resources: rows(rs, (x) => x), renterServices: rows(rsv, (x) => drop(x, /^productCost/)),   // a renter's costs are theirs (kept privately, lib/renter-service-costs)
    staff: rows(st, (x) => drop(x, STAFF_DROP)),
    studioEvents, pricingTiers: rows(pt, (x) => drop(x, GENERAL_DROP)),
    // Busy times are no longer sent — open times come from action 'availability'.
    appointments: [], scheduleProfiles: [], shifts: [], staffBlocks: [], dayOffBlocks: [], tickets: [], maintenancePlans: [], events: [],
  }, { headers: { 'Cache-Control': 'no-store' } });
}
