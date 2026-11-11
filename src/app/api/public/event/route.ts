// src/app/api/public/event/route.ts — THE SERVER BEHIND AN EVENT'S GUEST PAGES (lib/event-guest-link).
// The event page, the meal order page and a seat's QR code are opened by guests who aren't signed in, and the database
// only lets the business's team read events, guest lists and floor requests. So these pages ask here, and get back only
// what a guest may see: the event's name, date and place, places left (a number), the menu without costs, the seating
// chart's table and seat names, and for a seat the first name of whoever sits there. Never the guest list, never the PIN.
//   load     what a page shows (purpose 'seat' for a QR code); a private event shows only its name and date until its PIN
//   reserve  a place on the guest list (the event page)
//   order    a meal order (the meal order page): onto the guest's entry on the list, or a new one
//   request  a seat asks the floor team for something (onto the floor board)
// A guest's own place at a free event (lib/event-places), from the private link in their confirmation:
//   place    what their place page shows: the event, how many places, and whether it can still be changed
//   cancel   one place, or all of them; a place freed goes to the first person waiting whose party fits
//   give     a place to a friend (their own link by email; the place's meal and allergy answers are cleared)
//   waitlist join it when the event is full;  waitspot / leave  their waitlist link: where they are, or leave
import { NextRequest, NextResponse } from 'next/server';
import * as nextServer from 'next/server';
import { createHash, timingSafeEqual } from 'crypto';
import { getAdminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { bump, limitPublic, visitorIp } from '@/lib/rate-limit';
import { closedReply } from '@/lib/tenant-open-server';
import { anyToolOn, toolLocked } from '@/lib/tool-lock';
import { accessLockOf, CLOSED_FOR_CLIENTS } from '@/lib/tenant-access';
import { guestLogo } from '@/lib/brand';
import { brandColor, eventCapacity, eventToday } from '@/lib/studio-page';
import { addDays } from '@/lib/tenant-time';
import Stripe from 'stripe';
import { MAX_TICKETS, isPaidEvent, placesLeft, saleBlock, startTicketOrder, finishTicketOrder, releaseTicketOrder, ticketCents } from '@/lib/event-tickets';
import { WAITLIST_MAX, firstOf, heldForWaiting, newPartyId, newWaitId, onListEmail, partyOf, placeChangeBlock, placeKey, placeKeyOk, promoteFromWaitlist, tellOwner, tellPromoted, waitKeyOk, waitingFor, waitlistEmail, waitlistOpen } from '@/lib/event-places';
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
  // Tickets for a paid event (lib/event-tickets): opening a checkout, coming back from it paid, or coming back without paying.
  buy: { perHour: 12, perDay: 1000 },
  paid: { perHour: 120, perDay: 3000 },
  left: { perHour: 60, perDay: 3000 },
  // A guest's own place and the waitlist (lib/event-places).
  place: { perHour: 300, perDay: 5000 },
  cancel: { perHour: 30, perDay: 1000 },
  give: { perHour: 20, perDay: 500 },
  waitlist: { perHour: 20, perDay: 1000 },
  waitspot: { perHour: 300, perDay: 5000 },
  leave: { perHour: 30, perDay: 1000 },
};
const stripe = () => new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' as any });
const SEAT_PAUSE_MS = 30000;
const out = (body: any, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const clean = (v: any, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 32);
const firstName = (n: any) => clean(n, 80).split(' ')[0] || null;
const lower = (e: any) => String(e || '').trim().toLowerCase();
/** Emails go out after the answer (Next's after()), so a reply takes the same time whether or not one is sent. */
async function later(fn: () => Promise<any>) {
  const after = (nextServer as any).after;
  if (typeof after === 'function') { try { after(() => fn().catch((e: any) => console.error('[public-event] later', e?.message || e))); return; } catch { /* outside a request: now */ } }
  await fn().catch((e: any) => console.error('[public-event] later', e?.message || e));
}
const mealOpenFor = async (db: any, T: string, eventId: string, ev: any, today: string) => !orderBlock(ev, today) && !(await db.collection(`${T}/eventMenuItems`).where('eventId', '==', eventId).limit(1).get()).empty;

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
  const origin = req.nextUrl?.origin || null;   // links in guests' emails (lib/app-origin prefers the business's own)
  const evRef = db.doc(`${T}/studioEvents/${eventId}`); const guests = db.collection(`${T}/eventGuests`);
  const [tSnap, eSnap] = await Promise.all([db.doc(T).get(), evRef.get()]);
  const tenant: any = tSnap.data(); const ev: any = eSnap.data();
  if (!tenant || !ev) return out({ ok: false, error: 'We couldn’t find this event. The link may be out of date.', missing: true }, 404);
  const today = eventToday(tenant); const title = clean(ev.title || ev.name, 120) || 'the event';
  // A paused or locked business takes nothing new. Coming back from a payment already made still finishes it, and a
  // guest can still see, cancel or leave what they already have.
  // The same while Classes & events isn't part of the business's plan (lib/tool-lock): nothing new, and what a guest
  // already has stays theirs.
  if (!['load', 'paid', 'left', 'place', 'cancel', 'waitspot', 'leave'].includes(action)) {
    const closed = closedReply(tenant) || toolLocked(tenant, ['classes_events'], 'guest', 'This event isn’t taking sign-ups right now.'); if (closed) return closed;
  }

  try {
    // ── What a page shows ──
    if (action === 'load') {
      const business = { name: clean(tenant.name || tenant.businessName, 80), logoUrl: guestLogo(tenant) || null, color: brandColor(tenant) };
      const base = { title, date: /^\d{4}-\d{2}-\d{2}$/.test(String(ev.date || '')) ? String(ev.date) : null, time: clean(ev.time, 5) || null, endTime: clean(ev.endTime, 5) || null };
      if (accessLockOf(tenant).locked) return out({ ok: true, business, event: base, closed: true, message: CLOSED_FOR_CLIENTS });
      if (!anyToolOn(tenant, ['classes_events'])) return out({ ok: true, business, event: base, closed: true, message: 'This event isn’t taking sign-ups right now.' });
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
      const paidEvent = isPaidEvent(ev);
      const [gs, ms, os] = await Promise.all([guests.where('eventId', '==', eventId).get(), db.collection(`${T}/eventMenuItems`).where('eventId', '==', eventId).get(),
        paidEvent ? db.collection(`${T}/eventTicketOrders`).where('eventId', '==', eventId).get() : Promise.resolve({ docs: [] as any[] })]);
      const cap = eventCapacity(ev);
      // Places someone waiting would take come off what's shown as left (they're next in line).
      const waiting = cap > 0 && waitlistOpen(ev, today) ? (await db.collection(`${T}/eventWaitlist`).where('eventId', '==', eventId).get()).docs.map((d: any) => d.data() || {}).filter((w: any) => w.status !== 'moved') : [];
      const held = cap > 0 ? heldForWaiting(waiting, cap - gs.size, new Set(gs.docs.map((d: any) => lower(d.data()?.email)).filter(Boolean))) : 0;
      const free = cap > 0 ? Math.max(0, cap - gs.size - held) : null;
      const full = free === 0;
      return out({ ok: true, business, needsPin: false,
        event: { ...base, venue: clean(ev.venue, 120) || null, menuNote: clean(ev.menuNote, 280) || null, orderingDeadline: typeof ev.orderingDeadline === 'string' ? ev.orderingDeadline : null },
        reserve: { block: reserveBlock(ev, today), placesLeft: free, waitlist: full && waitlistOpen(ev, today) },
        // A paid event: its price, tickets left (less the places held by open checkouts) and whether they're on sale.
        ...(paidEvent ? { tickets: { cents: ticketCents(ev), left: placesLeft(ev, gs.size, os.docs.map((d: any) => d.data() || {})), block: saleBlock(ev, tenant, today), max: MAX_TICKETS } } : {}),
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

    // ── Back from a ticket checkout: paid (finished here if the payments notice hasn't yet), or left without paying ──
    if (action === 'paid') {
      const sessionId = String(b.session || '');
      if (!/^cs_[A-Za-z0-9_]{6,200}$/.test(sessionId) || !process.env.STRIPE_SECRET_KEY) return out({ ok: false, error: 'We couldn’t find that payment.' }, 404);
      const r = await finishTicketOrder(db, stripe(), tenantId, sessionId);
      if (!r.ok) return out({ ok: false, error: r.error === 'retry' ? 'We couldn’t check your payment just now. Please refresh in a moment.' : 'We couldn’t find that payment.', retry: r.error === 'retry' }, r.error === 'retry' ? 503 : 404);
      return out(r);
    }
    if (action === 'left') {
      if (process.env.STRIPE_SECRET_KEY && ID.test(String(b.order || ''))) await releaseTicketOrder(db, stripe(), tenantId, String(b.order)).catch((e: any) => console.error('[public-event] release', e?.message || e));
      return out({ ok: true });
    }

    const name = clean(b.name, 120); const email = String(b.email || '').trim().toLowerCase().slice(0, 160); const phone = clean(b.phone, 40);

    // ── A guest's own place, from the signed link in their email (no PIN: the link is the proof) ──
    if (action === 'place' || action === 'cancel' || action === 'give') {
      const partyId = String(b.p || '');
      if (!placeKeyOk(tenantId, eventId, partyId, b.k)) return out({ ok: false, error: 'This link isn’t right. Use the newest email we sent you.', gone: true }, 404);
      const business = { name: clean(tenant.name || tenant.businessName, 80), logoUrl: guestLogo(tenant) || null, color: brandColor(tenant) };
      const base = { title, date: /^\d{4}-\d{2}-\d{2}$/.test(String(ev.date || '')) ? String(ev.date) : null, time: clean(ev.time, 5) || null, endTime: clean(ev.endTime, 5) || null, venue: clean(ev.venue, 120) || null };
      if (action === 'place') {
        const party = partyOf((await guests.where('partyId', '==', partyId).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((g: any) => g.eventId === eventId), partyId);
        if (!party.length) return out({ ok: true, business, event: base, gone: true });
        const meal = await mealOpenFor(db, T, eventId, ev, today);
        return out({ ok: true, business, event: base, party: { firstName: firstOf(party[0].name), places: party.length }, block: placeChangeBlock(ev, today), mealOpen: meal });
      }
      const block = placeChangeBlock(ev, today); if (block) return out({ ok: false, error: block }, 409);
      if (action === 'cancel') {
        const all = b.all === true;
        // A paused business still lets a guest cancel; the waitlist waits until it's open again (the sweep).
        const paused = accessLockOf(tenant).locked;
        const r: any = await db.runTransaction(async (tx: any) => {
          const evNow: any = (await tx.get(evRef)).data() || {};
          const docs = (await tx.get(guests.where('eventId', '==', eventId))).docs.map((d: any) => ({ ref: d.ref, id: d.id, ...(d.data() || {}) }));
          const party = partyOf(docs, partyId); if (!party.length) return { ok: true, cancelled: 0, remaining: 0, already: true };
          // One place: a guest's own place goes first, theirs last (so the link keeps working while they have any).
          const drop = all || party.length === 1 ? party : [party[party.length - 1]];
          const gone = new Set(drop.map((g: any) => g.id));
          const stay = docs.filter((g: any) => !gone.has(g.id));
          const p = paused ? { promoted: [], added: 0, writes: [] as (() => void)[] } : await promoteFromWaitlist(tx, db, tenantId, eventId, evNow, stay.length, today, new Set(stay.map((g: any) => lower(g.email)).filter(Boolean)));
          drop.forEach((g: any) => tx.delete(g.ref));
          tx.set(evRef, { rsvpCount: stay.length }, { merge: true });
          p.writes.forEach((w) => w());   // last, so the count it sets (who's left plus who came in) is the one kept
          return { ok: true, cancelled: drop.length, remaining: party.length - drop.length, name: String(party[0].name || ''), promoted: p.promoted, ev: evNow };
        });
        if (r.cancelled) await later(async () => {
          await tellOwner(db, tenantId, tenant, eventId, `${clean(r.name, 80) || 'A guest'} canceled ${r.remaining === 0 ? (r.cancelled === 1 ? 'their place' : `all ${r.cancelled} places`) : 'one of their places'} at ${title}.`);
          await tellPromoted(db, tenantId, tenant, r.ev, eventId, origin, r.promoted || []);
        });
        return out({ ok: true, cancelled: r.cancelled, remaining: r.remaining });
      }
      // ── Giving a place to a friend ──
      if (!name || !EMAIL.test(email)) return out({ ok: false, error: 'Add your friend’s name and email.' }, 400);
      if (!(await bump(`event-give_${hash(`${tenantId}|${eventId}|${partyId}`)}_${Math.floor(Date.now() / 86400000)}`, 6, 2 * 86400000))) return out({ ok: false, error: 'That’s a lot of changes for one day. Please try again tomorrow.' }, 429);
      const friendParty = newPartyId();
      const r: any = await db.runTransaction(async (tx: any) => {
        const docs = (await tx.get(guests.where('eventId', '==', eventId))).docs.map((d: any) => ({ ref: d.ref, id: d.id, ...(d.data() || {}) }));
        const waiting = await waitingFor(tx, db, tenantId, eventId);
        const party = partyOf(docs, partyId); if (!party.length) return { ok: false, error: 'This place has already been canceled or given away.', status: 409 };
        // Already going: not given a second place (said the same way as any address we can't use, so it tells nobody
        // who's coming).
        if (docs.some((g: any) => lower(g.email) === email)) return { ok: false, error: 'We couldn’t give the place to that email. Check it, or give it to someone else.', status: 409 };
        const g = party[party.length - 1];
        // The place becomes theirs: their name, their own link, and none of the last person's answers, check-in or the
        // host's notes about them. The host's seat for the place stays.
        tx.set(g.ref, { name, email, phone, partyId: friendParty, partyLead: true, clientId: null, notes: '', checkedIn: false, checkedInAt: null,
          mealChoiceId: null, mealChoiceName: null, courseSelections: null, mealOverriddenAt: null, mealOverriddenBy: null, allergies: [], allergyNote: null,
          guestNote: null, dietaryRestrictions: [], orderedAt: null, reminderSentAt: null, reminderClaimAt: null, givenBy: clean(party[0].name, 120) || null, givenAt: new Date().toISOString(), source: 'given' }, { merge: true });
        // Waiting for this event too: not anymore.
        waiting.filter((w: any) => lower(w.email) === email).forEach((w: any) => tx.delete(w.ref));
        return { ok: true, from: String(party[0].name || ''), remaining: party.length - 1 };
      });
      if (!r.ok) return out({ ok: false, error: r.error }, r.status || 409);
      const meal = await mealOpenFor(db, T, eventId, ev, today);
      await later(async () => {
        await onListEmail(db, tenantId, tenant, ev, eventId, origin, { name, email, places: 1, partyId: friendParty, how: 'given', from: r.from }, meal);
        await tellOwner(db, tenantId, tenant, eventId, `${clean(r.from, 80) || 'A guest'} gave a place at ${title} to ${name}.`);
      });
      return out({ ok: true, friend: firstOf(name), remaining: r.remaining });
    }

    // ── Their waitlist link: where they are in line, or leave it ──
    if (action === 'waitspot' || action === 'leave') {
      const id = String(b.w || '');
      if (!waitKeyOk(tenantId, eventId, id, b.k)) return out({ ok: false, error: 'This link isn’t right. Use the newest email we sent you.', gone: true }, 404);
      const ref = db.doc(`${T}/eventWaitlist/${id}`); const w: any = (await ref.get()).data();
      const business = { name: clean(tenant.name || tenant.businessName, 80), logoUrl: guestLogo(tenant) || null, color: brandColor(tenant) };
      const base = { title, date: /^\d{4}-\d{2}-\d{2}$/.test(String(ev.date || '')) ? String(ev.date) : null, time: clean(ev.time, 5) || null, endTime: clean(ev.endTime, 5) || null, venue: clean(ev.venue, 120) || null };
      // Moved onto the guest list: their place's own link instead.
      if (w?.status === 'moved' && w.partyId) { const k = placeKey(tenantId, eventId, String(w.partyId)); return out({ ok: true, business, event: base, moved: k ? { p: String(w.partyId), k } : null }); }
      if (!w || w.eventId !== eventId) return out({ ok: true, business, event: base, gone: true });
      if (action === 'leave') {
        // In one step: if their place came through meanwhile, they're told so (and it's theirs to cancel from there).
        const gone: any = await db.runTransaction(async (tx: any) => { const cur: any = (await tx.get(ref)).data(); if (!cur) return 'gone'; if (cur.status === 'moved') return { moved: cur.partyId }; tx.delete(ref); return 'left'; });
        if (gone?.moved) { const k2 = placeKey(tenantId, eventId, String(gone.moved)); return out({ ok: true, business, event: base, moved: k2 ? { p: String(gone.moved), k: k2 } : null }); }
        if (gone === 'left') await later(() => tellOwner(db, tenantId, tenant, eventId, `${clean(w.name, 80) || 'A guest'} left the waitlist for ${title}.`));
        return out({ ok: true, left: true });
      }
      const ahead = (await db.collection(`${T}/eventWaitlist`).where('eventId', '==', eventId).get()).docs.map((d: any) => d.data() || {})
        .filter((x: any) => x.status !== 'moved' && String(x.joinedAt) < String(w.joinedAt)).length;
      return out({ ok: true, business, event: base, waiting: { firstName: firstOf(w.name), places: Math.max(1, Number(w.places) || 1), position: ahead + 1 }, block: reserveBlock(ev, today) });
    }

    // Reserving, ordering and buying all need a private event's PIN.
    const pin = await pinCheck(db, req, tenantId, eventId, ev, b.pin);
    if (pin === 'needed' || pin === 'wrong' || pin === 'locked') return out({ ok: false, error: PIN_REPLY[pin].error, needsPin: true }, PIN_REPLY[pin].status);

    // ── Tickets: the places are held and a checkout opens on the business's account (lib/event-tickets) ──
    if (action === 'buy') {
      if (!name || !EMAIL.test(email)) return out({ ok: false, error: 'Add your name and email.' }, 400);
      // A few checkouts an hour for one email, so nobody can hold an event's places by opening checkout after checkout.
      if (!(await bump(`event-buy-email_${hash(`${tenantId}|${eventId}|${email}`)}_${Math.floor(Date.now() / 3600000)}`, 4, 2 * 3600000))) return out({ ok: false, error: 'Too many tries for now. Please try again in an hour.' }, 429);
      const r = await startTicketOrder(db, stripe(), { tenantId, eventId, name, email, phone, qty: b.qty, origin: req.nextUrl.origin, today, visitor: hash(`${tenantId}|${visitorIp(req)}`) });
      return r.ok ? out({ ok: true, url: r.url }) : out({ ok: false, error: r.error, ...(typeof r.left === 'number' ? { left: r.left } : {}) }, r.status);
    }

    // ── A place on the guest list ──
    if (action === 'reserve') {
      const block = reserveBlock(ev, today); if (block) return out({ ok: false, error: block }, 409);
      if (!name || !EMAIL.test(email)) return out({ ok: false, error: 'Add your name and email.' }, 400);
      const places = Math.max(1, Math.min(4, Math.floor(Number(b.places) || 1)));
      // From any one visitor, at most three reservations for the same event a day, so no one can fill it alone.
      const capRef = db.collection('rateLimits').doc(`event-link-rsv_${hash(`${tenantId}|${eventId}|${visitorIp(req)}`)}_${Math.floor(Date.now() / 86400000)}`);
      const r: any = await db.runTransaction(async (tx: any) => {
        const evNow: any = (await tx.get(evRef)).data(); const made = Number(((await tx.get(capRef)).data() as any)?.count) || 0;
        const blockNow = evNow ? reserveBlock(evNow, today) : 'This event isn’t taking reservations.'; if (blockNow) return { ok: false, error: blockNow };
        const docs = (await tx.get(guests.where('eventId', '==', eventId))).docs;
        const list = docs.map((d: any) => d.data() || {});
        const emails = new Set<string>(list.map((g: any) => lower(g.email)).filter(Boolean));
        // Whoever is waiting goes first: places freed since are theirs before anyone new (and they're emailed).
        const pre = await promoteFromWaitlist(tx, db, tenantId, eventId, evNow, list.length, today, emails);
        pre.writes.forEach((w) => w());
        const onList = list.length + pre.added;
        if (made >= 3) return { ok: false, error: 'Too many reservations for this event from here today. To add more people, ask the business.', capped: true, promoted: pre.promoted, ev: evNow };
        const cap = eventCapacity(evNow); const left = cap > 0 ? cap - onList : Infinity;
        // Already on the list: answered exactly as anyone else would be (nobody can test who's coming), nothing added.
        // Their confirmation goes again to that email (theirs, not whoever typed it), with their link; an entry from
        // before places had links gets one now.
        const mine = docs.find((d: any) => lower(d.data()?.email) === email);
        // Just moved in from the waitlist in this very step: that's their place (they're emailed about it), nothing more.
        const justIn = pre.promoted.find((p) => p.email === email);
        let resend: any = null;
        if (mine) {
          const g: any = mine.data() || {}; const pid = g.partyId || newPartyId();
          if (!g.partyId) tx.set(mine.ref, { partyId: pid, partyLead: true }, { merge: true });
          resend = { name: String(g.name || name), email, places: g.partyId ? list.filter((x: any) => x.partyId === g.partyId).length : 1, partyId: pid };
        }
        if (justIn) return { ok: true, title, places, promoted: pre.promoted, ev: evNow };
        if (left <= 0) return { ok: false, error: 'This event is full.', full: true, resend, promoted: pre.promoted, ev: evNow };
        if (places > left) return { ok: false, error: `Only ${left} ${left === 1 ? 'place is' : 'places are'} left.`, left, resend, promoted: pre.promoted, ev: evNow };
        if (resend) return { ok: true, title, places, resend, promoted: pre.promoted, ev: evNow };
        const now = new Date().toISOString(); const partyId = newPartyId();
        for (let i = 0; i < places; i++) {
          const g = guests.doc();
          tx.set(g, { id: g.id, eventId, tenantId, name: i === 0 ? name : `${name} (guest ${i})`, email: i === 0 ? email : '', phone: i === 0 ? phone : '', tableId: null, tableNumber: null, seatNumber: null,
            notes: '', allergies: [], dietaryRestrictions: [], checkedIn: false, source: 'event link', submittedAt: now, partyId, partyLead: i === 0 });
        }
        tx.set(evRef, { rsvpCount: onList + places }, { merge: true });
        tx.set(capRef, { count: made + 1, expiresAt: new Date(Date.now() + 2 * 86400000) }, { merge: true });
        // Waiting for this event too (and not just moved in): not anymore.
        (pre.waiting || []).filter((w: any) => lower(w.email) === email && !pre.promoted.some((p) => p.email === email)).forEach((w: any) => tx.delete(w.ref));
        return { ok: true, title, places, sent: { name, email, places, partyId }, promoted: pre.promoted, ev: evNow };
      });
      // After the answer: the confirmation with the link to their place (sent again at most twice an hour to one
      // email), anyone who just came off the waitlist, and the owner told.
      const conf = r.sent || r.resend;
      await later(async () => {
        if (conf && (!r.resend || await bump(`event-resend_${hash(`${tenantId}|${eventId}|${email}`)}_${Math.floor(Date.now() / 3600000)}`, 2, 2 * 3600000)))
          await onListEmail(db, tenantId, tenant, ev, eventId, origin, { ...conf, how: 'reserved' }, await mealOpenFor(db, T, eventId, ev, today));
        if (r.promoted?.length) await tellPromoted(db, tenantId, tenant, r.ev || ev, eventId, origin, r.promoted);
        if (r.sent) await tellOwner(db, tenantId, tenant, eventId, `${name} reserved ${places === 1 ? 'a place' : `${places} places`} at ${title} from the event’s link.`);
      });
      const { capped, sent, resend, promoted, ev: _ev, ...body } = r; void sent; void resend; void promoted; void _ev;
      return out(body, r.ok ? 200 : capped ? 429 : 409);
    }

    // ── The waitlist, when a free event is full ──
    if (action === 'waitlist') {
      if (!waitlistOpen(ev, today)) return out({ ok: false, error: reserveBlock(ev, today) || 'This event doesn’t have a waitlist.' }, 409);
      if (!name || !EMAIL.test(email)) return out({ ok: false, error: 'Add your name and email.' }, 400);
      const places = Math.max(1, Math.min(4, Math.floor(Number(b.places) || 1)));
      if (places > eventCapacity(ev)) return out({ ok: false, error: `This event has ${eventCapacity(ev)} ${eventCapacity(ev) === 1 ? 'place' : 'places'} in all.` }, 400);
      const wl = db.collection(`${T}/eventWaitlist`); const id = newWaitId();
      const r: any = await db.runTransaction(async (tx: any) => {
        const evNow: any = (await tx.get(evRef)).data() || {};
        const list = (await tx.get(guests.where('eventId', '==', eventId))).docs.map((d: any) => d.data() || {});
        const waiting = (await tx.get(wl.where('eventId', '==', eventId))).docs.map((d: any) => d.data() || {}).filter((x: any) => x.status !== 'moved');
        const cap = eventCapacity(evNow);
        const free = cap - list.length - heldForWaiting(waiting, cap - list.length, new Set(list.map((g: any) => lower(g.email)).filter(Boolean)));
        if (cap > 0 && free > 0) return { ok: false, notFull: true, error: 'A place just opened up. You can reserve it now.', left: free };
        // Already waiting, or already going: told the same as joining, nothing added.
        if (list.some((g: any) => lower(g.email) === email) || waiting.some((x: any) => lower(x.email) === email)) return { ok: true, already: true };
        if (waiting.length >= WAITLIST_MAX) return { ok: false, error: 'The waitlist is full too. Please check back later.' };
        tx.set(wl.doc(id), { id, eventId, tenantId, name, email, phone, places, joinedAt: new Date().toISOString(), status: 'waiting' });
        return { ok: true, position: waiting.length + 1, ev: evNow };
      });
      if (r.ok && !r.already) await later(async () => {
        await waitlistEmail(db, tenantId, tenant, r.ev, eventId, origin, { id, name, email, places, position: r.position });
        await tellOwner(db, tenantId, tenant, eventId, `${name} joined the waitlist for ${title}${places > 1 ? ` (${places} places)` : ''}.`);
      });
      return out(r.ok ? { ok: true, waitlisted: true } : { ok: false, error: r.error, ...(r.notFull ? { notFull: true, left: r.left } : {}) }, r.ok ? 200 : 409);
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
      const waitingNow = waitlistOpen(evNow, today) ? await waitingFor(tx, db, tenantId, eventId) : [];
      const m = matchGuest(list, name, email);
      if (m.kind === 'already') return { ok: false, already: true, error: 'We already have a meal order for you. To change it, let your host know.' };
      if (m.kind === 'needEmail') return { ok: false, needEmail: true, error: 'Add the email you reserved with, so your order goes with your place.' };
      // A paid event's guests come from tickets: someone not on the list gets one first.
      if (m.kind === 'new' && isPaidEvent(evNow)) return { ok: false, needTicket: true, error: 'We couldn’t find you on the guest list. If you have a ticket, use the email you bought it with. If not, get one on the event’s page first.' };
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
      // Full, counting the places the people waiting are next in line for.
      const cap = eventCapacity(evNow);
      const heldNow = cap > 0 ? heldForWaiting(waitingNow, cap - list.length, new Set(list.map((g: any) => lower(g.email)).filter(Boolean))) : 0;
      if (cap > 0 && list.length + heldNow >= cap) return { ok: false, error: 'This event is full. If you’re on the guest list, use the name or email your host has for you.', full: true };
      if (added >= 6) return { ok: false, error: 'Too many new guests from here today. Ask your host to add the rest.' };
      const ref = guests.doc();
      tx.set(ref, { id: ref.id, eventId, tenantId, name, email, phone, tableId: null, tableNumber: table || null, seatNumber: seatNow || null, notes: '', dietaryRestrictions: [], checkedIn: false,
        source: 'meal order link', submittedAt: now, ...fields });
      tx.set(evRef, { rsvpCount: list.length + 1 }, { merge: true });
      tx.set(newRef, { count: added + 1, expiresAt: new Date(Date.now() + 2 * 86400000) }, { merge: true });
      return { ok: true, title, ...(seatTaken ? { seatTaken: true } : {}) };
    });
    return out(r, r.ok ? 200 : (r as any).needEmail ? 400 : 409);
  } catch (e: any) {
    console.error('[public-event]', action, e?.message || e);
    return out({ ok: false, error: 'That didn’t go through. Please try again in a moment.' }, 500);
  }
}
