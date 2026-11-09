// src/app/api/public/event/route.ts — THE SERVER BEHIND AN EVENT'S GUEST PAGES (lib/event-guest-link).
// The event page, the meal order page and a seat's QR code are opened by guests who aren't signed in, and the database
// only lets the business's team read events, guest lists and floor requests. So these pages ask here, and get back only
// what a guest may see: the event's name, date and place, places left (a number), the menu without costs, the seating
// chart's table and seat names, and for a seat the first name of whoever sits there. Never the guest list, never the PIN.
//   load     what a page shows (purpose 'seat' for a QR code); a private event shows only its name and date until its PIN
//   reserve  a place on the guest list (the event page)
//   order    a meal order (the meal order page): onto the guest's entry on the list, or a new one
//   request  a seat asks the floor team for something (onto the floor board)
import { NextRequest, NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'crypto';
import { getAdminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { bump, limitPublic, visitorIp } from '@/lib/rate-limit';
import { closedReply } from '@/lib/tenant-open-server';
import { accessLockOf, CLOSED_FOR_CLIENTS } from '@/lib/tenant-access';
import { guestLogo } from '@/lib/brand';
import { brandColor, eventCapacity, eventToday } from '@/lib/studio-page';
import { addDays } from '@/lib/tenant-time';
import { ALLERGY_CHOICES, allergyList, chartTables, findSeat, matchGuest, mealChoices, menuCourses, orderBlock, requestOpen, requestTypesFor, reserveBlock, seatFromCode } from '@/lib/event-guest-link';

export const dynamic = 'force-dynamic';

const ID = /^[A-Za-z0-9_-]{1,80}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const LIMITS: Record<string, { perHour: number; perDay: number }> = {
  load: { perHour: 600, perDay: 20000 },
  reserve: { perHour: 20, perDay: 1000 },
  // A whole dinner may order, and later call for water, over the venue's one connection.
  order: { perHour: 200, perDay: 3000 },
  request: { perHour: 300, perDay: 5000 },
};
const SEAT_PAUSE_MS = 30000;
const out = (body: any, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const clean = (v: any, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 32);
const firstName = (n: any) => clean(n, 80).split(' ')[0] || null;

/** A private event's PIN, checked here only. Every try is counted first, in one step on the database (so a burst of
 *  guesses at once can't all slip past the count), and only then compared: at most 12 an hour from one visitor and 500
 *  a day for the event. A right PIN gives its try back. */
async function pinCheck(db: any, req: NextRequest, tenantId: string, eventId: string, ev: any, given: any): Promise<'none' | 'ok' | 'needed' | 'wrong' | 'locked'> {
  const want = String(ev?.accessPin ?? '').trim(); if (!want) return 'none';
  const pin = String(given ?? '').trim(); if (!pin) return 'needed';
  const now = Date.now();
  const ipId = `event-pin_ip_${hash(`${tenantId}|${eventId}|${visitorIp(req)}`)}_${Math.floor(now / 3600000)}`;
  const evId = `event-pin_ev_${hash(`${tenantId}|${eventId}`)}_${Math.floor(now / 86400000)}`;
  if (!(await bump(ipId, 12, 2 * 3600000)) || !(await bump(evId, 500, 2 * 86400000))) return 'locked';
  const x = Buffer.from(pin), y = Buffer.from(want);
  if (x.length === y.length && timingSafeEqual(x, y)) {
    await Promise.all([ipId, evId].map((id) => db.collection('rateLimits').doc(id).set({ count: FieldValue.increment(-1) }, { merge: true }))).catch(() => undefined);
    return 'ok';
  }
  return 'wrong';
}
const PIN_REPLY = {
  needed: { error: 'Enter the event’s PIN to continue.', status: 403 },
  wrong: { error: 'That PIN isn’t right. Check it with your host and try again.', status: 403 },
  locked: { error: 'Too many tries with the wrong PIN. Please wait an hour, or ask your host for help.', status: 429 },
} as const;

/** Seconds before a seat can ask again (a few seconds between taps keeps one guest from filling the board). */
const seatWait = (requests: any[], tableId: string, seatId: string, now = Date.now()) => {
  const last = requests.filter((r) => r.tableId === tableId && r.seatId === seatId).map((r) => Date.parse(String(r.createdAt || ''))).filter((t) => !isNaN(t)).sort((a, b) => b - a)[0];
  return last && now - last < SEAT_PAUSE_MS ? Math.ceil((SEAT_PAUSE_MS - (now - last)) / 1000) : 0;
};

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const action = String(b?.action || 'load');
  if (!LIMITS[action]) return out({ ok: false, error: 'Unknown request.' }, 400);
  const tenantId = String(b.tenantId || ''), eventId = String(b.eventId || '');
  if (!ID.test(tenantId) || !ID.test(eventId)) return out({ ok: false, error: 'This link isn’t complete. Please check it and try again.' }, 400);
  // A form field people never see: filled in means a script. It's answered like anyone, and nothing is written.
  if (action !== 'load' && String(b.ev_ref || '').trim()) { console.warn('[public-event] trap field filled', tenantId, eventId, action); return out({ ok: true, title: 'the event' }); }
  const limited = await limitPublic(req, `event-${action}`, tenantId, LIMITS[action]); if (limited) return limited;

  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const evRef = db.doc(`${T}/studioEvents/${eventId}`); const guests = db.collection(`${T}/eventGuests`);
  const [tSnap, eSnap] = await Promise.all([db.doc(T).get(), evRef.get()]);
  const tenant: any = tSnap.data(); const ev: any = eSnap.data();
  if (!tenant || !ev) return out({ ok: false, error: 'We couldn’t find this event. The link may be out of date.', missing: true }, 404);
  const today = eventToday(tenant); const title = clean(ev.title || ev.name, 120) || 'the event';
  if (action !== 'load') { const closed = closedReply(tenant); if (closed) return closed; }

  try {
    // ── What a page shows ──
    if (action === 'load') {
      const business = { name: clean(tenant.name || tenant.businessName, 80), logoUrl: guestLogo(tenant) || null, color: brandColor(tenant) };
      const base = { title, date: /^\d{4}-\d{2}-\d{2}$/.test(String(ev.date || '')) ? String(ev.date) : null, time: clean(ev.time, 5) || null, endTime: clean(ev.endTime, 5) || null };
      if (accessLockOf(tenant).locked) return out({ ok: true, business, event: base, closed: true, message: CLOSED_FOR_CLIENTS });
      if (b.purpose === 'seat') {
        const where = findSeat(ev, String(b.tableId || ''), String(b.seatId || ''));
        if (!where) return out({ ok: false, error: 'This seat’s code is out of date. Please ask a member of the team.', missing: true }, 404);
        const [gs, rs] = await Promise.all([guests.where('eventId', '==', eventId).get(), db.collection(`${T}/floorRequests`).where('eventId', '==', eventId).get()]);
        const g = gs.docs.map((d: any) => d.data() || {}).find((x: any) => x.tableNumber === where.table.name && x.seatNumber === where.seat.label);
        return out({ ok: true, business, event: base, seat: { tableName: where.table.name, seatLabel: where.seat.label, firstName: g ? firstName(g.name) : null,
          open: requestOpen(ev, today, addDays(today, -1)), types: requestTypesFor(ev, tenant), waitSeconds: seatWait(rs.docs.map((d: any) => d.data() || {}), where.table.id, where.seat.id) } });
      }
      const pin = await pinCheck(db, req, tenantId, eventId, ev, b.pin);
      if (pin === 'needed' || pin === 'wrong' || pin === 'locked') return out({ ok: true, business, event: base, needsPin: true, pinError: pin === 'needed' ? null : PIN_REPLY[pin].error });
      const [gs, ms] = await Promise.all([guests.where('eventId', '==', eventId).get(), db.collection(`${T}/eventMenuItems`).where('eventId', '==', eventId).get()]);
      const cap = eventCapacity(ev);
      return out({ ok: true, business, needsPin: false,
        event: { ...base, venue: clean(ev.venue, 120) || null, menuNote: clean(ev.menuNote, 280) || null, orderingDeadline: typeof ev.orderingDeadline === 'string' ? ev.orderingDeadline : null },
        reserve: { block: reserveBlock(ev, today), placesLeft: cap > 0 ? Math.max(0, cap - gs.size) : null },
        order: { block: orderBlock(ev, today), courses: menuCourses(ms.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }))), tables: chartTables(ev).map((t) => ({ name: t.name, seats: t.seats.map((s) => s.label) })) },
        allergies: ALLERGY_CHOICES });
    }

    // ── A seat asks the floor team ──
    if (action === 'request') {
      const where = findSeat(ev, String(b.tableId || ''), String(b.seatId || ''));
      if (!where) return out({ ok: false, error: 'This seat’s code is out of date. Please ask a member of the team.' }, 404);
      if (!requestOpen(ev, today, addDays(today, -1))) return out({ ok: false, error: 'Requests open on the day of the event.' }, 409);
      const type = requestTypesFor(ev, tenant).find((t) => t.id === String(b.type || ''));
      if (!type) return out({ ok: false, error: 'Choose what you need from the list.' }, 400);
      const note = clean(b.note, 160);
      const reqs = db.collection(`${T}/floorRequests`);
      const r = await db.runTransaction(async (tx: any) => {
        const all = (await tx.get(reqs.where('eventId', '==', eventId))).docs.map((d: any) => d.data() || {});
        const wait = seatWait(all, where.table.id, where.seat.id); if (wait) return { ok: false, error: `You just asked. You can ask again in ${wait} seconds.`, waitSeconds: wait, status: 429 };
        if (all.some((x: any) => x.tableId === where.table.id && x.seatId === where.seat.id && x.requestType === type.id && x.status !== 'done')) return { ok: false, error: 'Someone is already on the way for that.', status: 409 };
        const g = (await tx.get(guests.where('eventId', '==', eventId))).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).find((x: any) => x.tableNumber === where.table.name && x.seatNumber === where.seat.label);
        const ref = reqs.doc(); const now = new Date().toISOString();
        tx.set(ref, { id: ref.id, tenantId, eventId, tableId: where.table.id, tableNumber: where.table.name, seatId: where.seat.id, seatNumber: where.seat.label,
          guestId: g?.id || null, guestName: g ? clean(g.name, 80) : null, guestAllergies: Array.isArray(g?.allergies) ? g.allergies : [],
          requestType: type.id, type: type.id, label: type.label, message: note ? `${type.label}: "${note}"` : null, requestText: note || null,
          status: 'new', source: 'guest_qr', createdAt: now, waitSeconds: null });
        return { ok: true, label: type.label, waitSeconds: Math.round(SEAT_PAUSE_MS / 1000) };
      });
      const { status, ...body } = r as any; return out(body, r.ok ? 200 : status || 409);
    }

    // Reserving and ordering both need a private event's PIN.
    const pin = await pinCheck(db, req, tenantId, eventId, ev, b.pin);
    if (pin === 'needed' || pin === 'wrong' || pin === 'locked') return out({ ok: false, error: PIN_REPLY[pin].error, needsPin: true }, PIN_REPLY[pin].status);
    const name = clean(b.name, 120); const email = String(b.email || '').trim().toLowerCase().slice(0, 160); const phone = clean(b.phone, 40);

    // ── A place on the guest list ──
    if (action === 'reserve') {
      const block = reserveBlock(ev, today); if (block) return out({ ok: false, error: block }, 409);
      if (!name || !EMAIL.test(email)) return out({ ok: false, error: 'Add your name and email.' }, 400);
      const places = Math.max(1, Math.min(4, Math.floor(Number(b.places) || 1)));
      // From any one visitor, at most three reservations for the same event a day, so no one can fill it alone.
      const capRef = db.collection('rateLimits').doc(`event-link-rsv_${hash(`${tenantId}|${eventId}|${visitorIp(req)}`)}_${Math.floor(Date.now() / 86400000)}`);
      const r = await db.runTransaction(async (tx: any) => {
        const evNow: any = (await tx.get(evRef)).data(); const made = Number(((await tx.get(capRef)).data() as any)?.count) || 0;
        const blockNow = evNow ? reserveBlock(evNow, today) : 'This event isn’t taking reservations.'; if (blockNow) return { ok: false, error: blockNow };
        const list = (await tx.get(guests.where('eventId', '==', eventId))).docs.map((d: any) => d.data() || {});
        // Already on the list: told the same as a new reservation (nobody can test who's coming), nothing added.
        if (list.some((g: any) => String(g.email || '').trim().toLowerCase() === email)) return { ok: true, already: true, title, places };
        const cap = eventCapacity(evNow); const left = cap > 0 ? cap - list.length : Infinity;
        if (left <= 0) return { ok: false, error: 'This event is full.', full: true };
        if (places > left) return { ok: false, error: `Only ${left} ${left === 1 ? 'place is' : 'places are'} left.`, left };
        if (made >= 3) return { ok: false, error: 'Too many reservations for this event from here today. To add more people, ask the business.', capped: true };
        const now = new Date().toISOString();
        for (let i = 0; i < places; i++) {
          const g = guests.doc();
          tx.set(g, { id: g.id, eventId, tenantId, name: i === 0 ? name : `${name} (guest ${i})`, email: i === 0 ? email : '', phone: i === 0 ? phone : '', tableId: null, tableNumber: null, seatNumber: null,
            notes: '', allergies: [], dietaryRestrictions: [], checkedIn: false, source: 'event link', submittedAt: now });
        }
        tx.set(evRef, { rsvpCount: (Number(evNow.rsvpCount) || 0) + places }, { merge: true });
        tx.set(capRef, { count: made + 1, expiresAt: new Date(Date.now() + 2 * 86400000) }, { merge: true });
        return { ok: true, title, places };
      });
      if (r.ok && !(r as any).already && tenant.userId) await db.collection(`${T}/notifications`).add({ userId: String(tenant.userId), type: 'event_reservation', message: `${name} reserved ${places === 1 ? 'a place' : `${places} places`} at ${title} from the event’s link.`, link: `/events/${eventId}/manifest`, read: false, createdAt: new Date().toISOString() }).catch(() => undefined);
      const { already, capped, ...body } = r as any; void already;
      return out(body, r.ok ? 200 : capped ? 429 : 409);
    }

    // ── A meal order ──
    const block = orderBlock(ev, today); if (block) return out({ ok: false, error: block }, 409);
    if (!name) return out({ ok: false, error: 'Add your name.' }, 400);
    if (email && !EMAIL.test(email)) return out({ ok: false, error: 'Check your email address.' }, 400);
    const tables = chartTables(ev); const named = tables.map((t) => ({ name: t.name, seats: t.seats.map((x) => x.label) }));
    let table = clean(b.table, 40); let seat = clean(b.seat, 12);
    if (tables.length && table && !tables.some((t) => t.name === table)) ({ table, seat } = seatFromCode(named, table, seat));
    if (tables.length && table) {
      const t = tables.find((x) => x.name === table); if (!t) return out({ ok: false, error: 'Choose your table from the list.' }, 400);
      if (seat && !t.seats.some((s) => s.label === seat)) return out({ ok: false, error: 'Choose your seat from the list.' }, 400);
    }
    if (!table) seat = '';
    const menu = (await db.collection(`${T}/eventMenuItems`).where('eventId', '==', eventId).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
    const meal = mealChoices(menuCourses(menu), b.picks); if (!meal.ok) return out({ ok: false, error: meal.error }, 400);
    const allergies = allergyList(b.allergies); const allergyNote = clean(b.allergyNote, 280); const guestNote = clean(b.note, 280);
    if ((allergies.length || allergyNote) && b.confirm !== true) return out({ ok: false, error: 'Please confirm your allergy details are right.' }, 400);
    // New guests from meal orders: at most six a day from any one visitor, so no one can fill an event with made-up names.
    const newRef = db.collection('rateLimits').doc(`event-order-new_${hash(`${tenantId}|${eventId}|${visitorIp(req)}`)}_${Math.floor(Date.now() / 86400000)}`);
    const r = await db.runTransaction(async (tx: any) => {
      const evNow: any = (await tx.get(evRef)).data(); const added = Number(((await tx.get(newRef)).data() as any)?.count) || 0;
      const blockNow = evNow ? orderBlock(evNow, today) : 'This event isn’t taking orders.'; if (blockNow) return { ok: false, error: blockNow };
      const docs = (await tx.get(guests.where('eventId', '==', eventId))).docs; const list = docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
      const m = matchGuest(list, name, email);
      if (m.kind === 'already') return { ok: false, already: true, error: 'We already have a meal order for you. To change it, let your host know.' };
      if (m.kind === 'needEmail') return { ok: false, needEmail: true, error: 'Add the email you reserved with, so your order goes with your place.' };
      // One guest to a seat: a seat someone else already has is left off (their table still counts).
      const mine = m.kind === 'update' ? m.id : null;
      const seatTaken = !!(table && seat && list.some((g: any) => g.id !== mine && g.tableNumber === table && g.seatNumber === seat)); const seatNow = seatTaken ? '' : seat;
      const now = new Date().toISOString();
      const fields: any = { mealChoiceId: meal.mealChoiceId, mealChoiceName: meal.mealChoiceName, courseSelections: meal.courseSelections, allergies, allergyNote: allergyNote || null, guestNote: guestNote || null, orderedAt: now };
      if (m.kind === 'update') {
        const g: any = list.find((x: any) => x.id === m.id) || {};
        // The host's seating stands; the guest's table fills in only where the host hasn't seated them.
        tx.set(guests.doc(m.id), { ...fields, ...(email && !String(g.email || '').trim() ? { email } : {}), ...(phone && !String(g.phone || '').trim() ? { phone } : {}),
          ...(table && !g.tableNumber ? { tableNumber: table, seatNumber: seatNow || null } : {}) }, { merge: true });
        return { ok: true, title, ...(seatTaken && !g.tableNumber ? { seatTaken: true } : {}) };
      }
      if (!email) return { ok: false, needEmail: true, error: 'Add your email so your host can reach you.' };
      const cap = eventCapacity(evNow); if (cap > 0 && list.length >= cap) return { ok: false, error: 'This event is full. If you’re on the guest list, use the name or email your host has for you.', full: true };
      if (added >= 6) return { ok: false, error: 'Too many new guests from here today. Ask your host to add the rest.' };
      const ref = guests.doc();
      tx.set(ref, { id: ref.id, eventId, tenantId, name, email, phone, tableId: null, tableNumber: table || null, seatNumber: seatNow || null, notes: '', dietaryRestrictions: [], checkedIn: false,
        source: 'meal order link', submittedAt: now, ...fields });
      tx.set(evRef, { rsvpCount: (Number(evNow.rsvpCount) || 0) + 1 }, { merge: true });
      tx.set(newRef, { count: added + 1, expiresAt: new Date(Date.now() + 2 * 86400000) }, { merge: true });
      return { ok: true, title, ...(seatTaken ? { seatTaken: true } : {}) };
    });
    return out(r, r.ok ? 200 : (r as any).needEmail ? 400 : 409);
  } catch (e: any) {
    console.error('[public-event]', action, e?.message || e);
    return out({ ok: false, error: 'That didn’t go through. Please try again in a moment.' }, 500);
  }
}
