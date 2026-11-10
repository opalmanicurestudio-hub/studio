// src/lib/event-places.ts — A GUEST'S OWN PLACE AT A FREE EVENT, after they reserve (api/public/event):
//   • the confirmation email, with a private link to their place (/event/{t}/{e}/place?p=…&k=…, signed like a portal
//     link, lib/portal-key; on a live site only with the real LINK_SECRET). Reserving again with the same email sends it
//     again to that email, so a lost email is never a dead end;
//   • on that page: cancel one place or all of them, or give a place to a friend (the friend gets their own link; the
//     place's meal, allergy, check-in and notes are cleared, since they were someone else's; the host's seat stays);
//   • the waitlist when the event is full: a place that frees up goes to the first person waiting whose party fits,
//     straight onto the guest list, and they're emailed with their own link. Anyone new reserving or ordering a meal
//     waits behind them. The hourly sweep fills places freed any other way (the team removing someone, more places);
//   • a reminder the day before, from the business's sending hour until 8pm their time, once per party (and once per
//     ticket buyer, and per older entry with an email).
// A party is the places one person reserved together: guest entries sharing a partyId, the first one theirs
// (partyLead). Entries made before parties existed, and ticket buyers, have no party link: they get the reminder only.
// Waitlist entries live in tenants/{t}/eventWaitlist (the team sees and can edit them; guests only through the server).
// No guest gets more than a few of these emails a day, whoever types their address.
import { createHash, randomBytes } from 'crypto';
import { checkPortalKey, portalKey } from '@/lib/portal-key';
import { eventCapacity, eventToday } from '@/lib/studio-page';
import { eventState, orderBlock, reserveBlock } from '@/lib/event-guest-link';
import { isPaidEvent } from '@/lib/event-tickets';
import { linkOrigin } from '@/lib/app-origin';
import { accessLockOf } from '@/lib/tenant-access';
import { addDays, hourIn, tenantTimeZone } from '@/lib/tenant-time';

export const WAITLIST_MAX = 100;
const MAILS_PER_DAY = 5;
export const PARTY_RE = /^p[a-f0-9]{24}$/;
export const WAIT_RE = /^w[a-f0-9]{24}$/;
export const newPartyId = () => `p${randomBytes(12).toString('hex')}`;
export const newWaitId = () => `w${randomBytes(12).toString('hex')}`;
const lower = (e: any) => String(e || '').trim().toLowerCase();

// These links cancel and give away places, so on a live site (any deployment, or any production build) they're signed
// only with the real secret.
const signable = () => !!process.env.LINK_SECRET || (!process.env.VERCEL_ENV && process.env.NODE_ENV !== 'production');
const signed = (kind: 'place' | 'wait', eventId: string, id: string) => `event-${kind}:${eventId}:${id}`;
export const placeKey = (tenantId: string, eventId: string, partyId: string) => (signable() ? portalKey(tenantId, signed('place', eventId, partyId)) : null);
export const waitKey = (tenantId: string, eventId: string, id: string) => (signable() ? portalKey(tenantId, signed('wait', eventId, id)) : null);
export const placeKeyOk = (tenantId: string, eventId: string, partyId: unknown, key: unknown) =>
  signable() && typeof partyId === 'string' && PARTY_RE.test(partyId) && checkPortalKey(tenantId, signed('place', eventId, partyId), key);
export const waitKeyOk = (tenantId: string, eventId: string, id: unknown, key: unknown) =>
  signable() && typeof id === 'string' && WAIT_RE.test(id) && checkPortalKey(tenantId, signed('wait', eventId, id), key);

const enc = encodeURIComponent;
/** The guest's private link to their place, or null when links can't be signed here. */
export function placeUrl(tenant: any, origin: string | null, tenantId: string, eventId: string, partyId: string): string | null {
  const k = placeKey(tenantId, eventId, partyId); const base = linkOrigin(tenant, origin || '');
  return k && base ? `${base}/event/${enc(tenantId)}/${enc(eventId)}/place?p=${partyId}&k=${k}` : null;
}
export function waitUrl(tenant: any, origin: string | null, tenantId: string, eventId: string, id: string): string | null {
  const k = waitKey(tenantId, eventId, id); const base = linkOrigin(tenant, origin || '');
  return k && base ? `${base}/event/${enc(tenantId)}/${enc(eventId)}/place?w=${id}&k=${k}` : null;
}

/** A party's entries, theirs first, then their guests in the order they were added. */
export function partyOf(list: any[], partyId: string): any[] {
  return list.filter((g) => g.partyId === partyId).sort((a, b) => (a.partyLead ? -1 : b.partyLead ? 1 : String(a.name).localeCompare(String(b.name), undefined, { numeric: true })));
}

/** Why a guest's own link can't change their place now, or null when it can. */
export function placeChangeBlock(ev: any, today: string): string | null {
  const s = eventState(ev, today);
  if (s === 'cancelled') return 'This event has been canceled.';
  if (s === 'over') return 'This event has already happened.';
  if (isPaidEvent(ev)) return 'Tickets are changed by the business. Reply to your ticket email and they’ll help.';
  return null;
}

/** Whether this event can have a waitlist at all: a free event that takes reservations and has a set number of places. */
export function waitlistOpen(ev: any, today: string): boolean {
  return !reserveBlock(ev, today) && !isPaidEvent(ev) && eventCapacity(ev) > 0;
}

/** First name only, as a guest typed it: letters, apostrophes and hyphens (nothing that reads as a link in an email). */
export const firstOf = (n: any) => (String(n || '').replace(/\s*\(guest \d+\)\s*$/i, '').trim().split(/\s+/)[0] || '').replace(/[^\p{L}'’-]/gu, '').slice(0, 30);

export type Promoted = { name: string; email: string; phone: string; places: number; partyId: string };

/** Those waiting, in the order they joined (not already moved onto the list). */
export async function waitingFor(tx: any, db: any, tenantId: string, eventId: string): Promise<any[]> {
  return (await tx.get(db.collection(`tenants/${tenantId}/eventWaitlist`).where('eventId', '==', eventId))).docs
    .map((d: any) => ({ ref: d.ref, id: d.id, ...(d.data() || {}) })).filter((w: any) => w.status !== 'moved')
    .sort((a: any, b: any) => String(a.joinedAt).localeCompare(String(b.joinedAt)));
}

/** How many of `free` places the people waiting would take (each party that fits, in order). */
export function heldForWaiting(waiting: any[], free: number, onListEmails: Set<string>): number {
  let left = Math.max(0, free); let held = 0;
  for (const w of waiting) {
    if (onListEmails.has(lower(w.email))) continue;
    const n = Math.max(1, Math.min(4, Math.floor(Number(w.places) || 1)));
    if (n <= left) { left -= n; held += n; }
    if (left <= 0) break;
  }
  return held;
}

/** Inside a step on the database: fills free places from the waitlist, in the order people joined, skipping a party
 *  that doesn't fit (it keeps its turn for the next place). Someone waiting who is already on the list (the team added
 *  them, a friend gave them a place) comes off the waitlist instead. Reads first (Firestore wants every read before any
 *  write); the writes are returned to run after the caller's own. `onList` is the guest count after the caller's own
 *  changes, and the event's count is set from it. */
export async function promoteFromWaitlist(tx: any, db: any, tenantId: string, eventId: string, ev: any, onList: number, today: string, onListEmails: Set<string>): Promise<{ promoted: Promoted[]; added: number; writes: (() => void)[]; waiting: any[] }> {
  const writes: (() => void)[] = []; const promoted: Promoted[] = [];
  if (!waitlistOpen(ev, today)) return { promoted, added: 0, writes, waiting: [] };
  const waiting = await waitingFor(tx, db, tenantId, eventId);
  const cap = eventCapacity(ev); let left = cap - onList;
  const T = `tenants/${tenantId}`; const now = new Date().toISOString();
  for (const w of waiting) {
    if (onListEmails.has(lower(w.email))) { writes.push(() => tx.delete(w.ref)); continue; }
    const places = Math.max(1, Math.min(4, Math.floor(Number(w.places) || 1)));
    if (left <= 0 || places > left) continue;
    left -= places;
    const partyId = newPartyId();
    const p: Promoted = { name: String(w.name || ''), email: lower(w.email), phone: String(w.phone || ''), places, partyId };
    promoted.push(p);
    writes.push(() => {
      for (let i = 0; i < places; i++) {
        const g = db.collection(`${T}/eventGuests`).doc();
        tx.set(g, { id: g.id, eventId, tenantId, name: i === 0 ? p.name : `${p.name} (guest ${i})`, email: i === 0 ? p.email : '', phone: i === 0 ? p.phone : '',
          tableId: null, tableNumber: null, seatNumber: null, notes: '', allergies: [], dietaryRestrictions: [], checkedIn: false,
          source: 'waitlist', partyId, partyLead: i === 0, submittedAt: now });
      }
      // Kept, marked moved, so their waitlist link opens their place.
      tx.set(w.ref, { status: 'moved', partyId, movedAt: now }, { merge: true });
    });
  }
  const added = promoted.reduce((s, p) => s + p.places, 0);
  if (added) writes.push(() => tx.set(db.doc(`${T}/studioEvents/${eventId}`), { rsvpCount: onList + added }, { merge: true }));
  return { promoted, added, writes, waiting };
}

// ── What guests are told ────────────────────────────────────────────────────────────────────────────────────────────
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export function whenLine(ev: any): string {
  const d = DAY.test(String(ev?.date || '')) ? new Date(`${ev.date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }) : '';
  const t = /^\d{2}:\d{2}$/.test(String(ev?.time || '')) ? (() => { const h = Number(ev.time.slice(0, 2)), m = ev.time.slice(3); return `${h % 12 || 12}${m === '00' ? '' : `:${m}`}${h < 12 ? 'am' : 'pm'}`; })() : '';
  return [d, t].filter(Boolean).join(' at ');
}

type Say = { subject: string; heading: string; lines: string[]; cta?: { label: string; url: string } | null; secondary?: { label: string; url: string } | null; typed?: boolean };
/** One email to a guest, in the business's look. Emails to an address someone just typed (a reservation, a place given,
 *  joining the waitlist) are at most a few a day to one address from one business, whoever typed it; a reminder or a
 *  place coming through isn't held back by them. Never throws; true when it went. */
export async function emailGuest(db: any, tenantId: string, tenant: any, ev: any, to: string, name: string, say: Say): Promise<boolean> {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(to || ''))) return false;
  try {
    if (say.typed) {
      const { bump } = await import('@/lib/rate-limit');
      const who = createHash('sha256').update(`${tenantId}|${lower(to)}`).digest('hex').slice(0, 32);
      if (!(await bump(`event-mail_${who}_${Math.floor(Date.now() / 86400000)}`, MAILS_PER_DAY, 2 * 86400000))) return false;
    }
    const { sendNotification } = await import('@/lib/notify');
    const { brandedEmailHtml } = await import('@/lib/email-template');
    const title = String(ev?.title || ev?.name || 'the event').slice(0, 120);
    const details = { big: whenLine(ev) || title, lines: [whenLine(ev) ? title : '', String(ev?.venue || '').slice(0, 120)].filter(Boolean) };
    const text = [...say.lines, [details.big, ...details.lines].join('\n'), ...(say.cta ? [`${say.cta.label}: ${say.cta.url}`] : []), ...(say.secondary ? [`${say.secondary.label}: ${say.secondary.url}`] : [])].join('\n\n');
    const html = brandedEmailHtml({ studioName: String(tenant?.name || tenant?.businessName || ''), title: say.heading, preheader: say.lines[1] || say.lines[0], bodyLines: say.lines, details, cta: say.cta || null, secondaryCta: say.secondary || null } as any);
    const r: any = await sendNotification(db, { tenantId, channel: 'email', to, kind: 'event_place', subject: say.subject, text, html, recipientType: 'client', clientName: firstOf(name) } as any);
    return !!r?.ok;
  } catch (e: any) { console.error('[event-places] email not sent', tenantId, e?.message || e); return false; }
}

const titleOf = (ev: any) => String(ev?.title || ev?.name || 'the event').slice(0, 120);
const hi = (name: string) => `Hi ${firstOf(name) || 'there'},`;
export const mealUrl = (tenant: any, origin: string | null, tenantId: string, eventId: string) => { const b = linkOrigin(tenant, origin || ''); return b ? `${b}/event/${enc(tenantId)}/${enc(eventId)}/rsvp` : null; };

/** "You're on the list": after reserving (or reserving again), after a friend gave them a place, after the waitlist. */
export function onListEmail(db: any, tenantId: string, tenant: any, ev: any, eventId: string, origin: string | null, g: { name: string; email: string; places: number; partyId: string; how: 'reserved' | 'given' | 'waitlist'; from?: string }, meal: boolean) {
  const title = titleOf(ev); const link = placeUrl(tenant, origin, tenantId, eventId, g.partyId); const mealLink = meal ? mealUrl(tenant, origin, tenantId, eventId) : null;
  const first = g.how === 'given' ? `${firstOf(g.from || '') || 'A friend'} gave you their place at ${title}.`
    : g.how === 'waitlist' ? `Good news: a place opened up at ${title}, and it’s yours. You’re on the guest list now.`
    : g.places > 1 ? `We’ve saved ${g.places} places under your name at ${title}. Your guests just give your name at the door.` : `We’ve saved your place at ${title}.`;
  const lines = [hi(g.name), first, link ? 'Plans change. If you can’t make it, use the button below to cancel or give your place to a friend, so someone else can come.' : 'If your plans change, reply to this email and let the business know.'];
  return emailGuest(db, tenantId, tenant, ev, g.email, g.name, {
    typed: g.how !== 'waitlist',
    subject: g.how === 'waitlist' ? `A place opened up: you’re going to ${title}` : g.how === 'given' ? `You have a place at ${title}` : `You’re on the list for ${title}`,
    heading: g.how === 'waitlist' ? 'A place opened up' : 'You’re on the list', lines,
    cta: link ? { label: 'See or change your place', url: link } : null, secondary: mealLink ? { label: 'Choose your meal', url: mealLink } : null,
  });
}

export function waitlistEmail(db: any, tenantId: string, tenant: any, ev: any, eventId: string, origin: string | null, w: { id: string; name: string; email: string; places: number; position: number }) {
  const title = titleOf(ev); const link = waitUrl(tenant, origin, tenantId, eventId, w.id);
  return emailGuest(db, tenantId, tenant, ev, w.email, w.name, {
    typed: true, subject: `You’re on the waitlist for ${title}`, heading: 'You’re on the waitlist',
    lines: [hi(w.name), `${title} is full right now, so we’ve put you on the waitlist${w.places > 1 ? ` for ${w.places} places` : ''}. You’re number ${w.position}.`,
      'If a place opens up, it’s yours straight away: we’ll put you on the guest list and email you. There’s nothing else to do.'],
    cta: link ? { label: 'Leave the waitlist', url: link } : null,
  });
}

/** The business is told about changes a guest made on their own, in their notifications. */
export async function tellOwner(db: any, tenantId: string, tenant: any, eventId: string, message: string): Promise<void> {
  if (!tenant?.userId) return;
  await db.collection(`tenants/${tenantId}/notifications`).add({ userId: String(tenant.userId), type: 'event_reservation', message, link: `/events/${eventId}/manifest`, read: false, createdAt: new Date().toISOString() }).catch(() => undefined);
}

/** Someone moved off the waitlist: emailed, the owner told, and the email marked sent on their entry (the sweep tries
 *  again when it didn't go). */
export async function tellPromoted(db: any, tenantId: string, tenant: any, ev: any, eventId: string, origin: string | null, promoted: Promoted[]): Promise<void> {
  for (const p of promoted) {
    const ok = await onListEmail(db, tenantId, tenant, ev, eventId, origin, { ...p, how: 'waitlist' }, false);
    if (ok) {
      const lead = (await db.collection(`tenants/${tenantId}/eventGuests`).where('partyId', '==', p.partyId).get()).docs.find((d: any) => d.data()?.partyLead);
      if (lead) await lead.ref.set({ notifiedAt: new Date().toISOString() }, { merge: true }).catch(() => undefined);
    }
    await tellOwner(db, tenantId, tenant, eventId, `${p.name} moved from the waitlist onto the guest list for ${titleOf(ev)}${p.places > 1 ? ` (${p.places} places)` : ''}.`);
  }
}

// ── The hourly sweep (cron/reminders) ─────────────────────────────────────────────────────────────────────────────────
/** Reminders the day before, waitlists filled from places freed any other way, a promotion email that didn't go sent
 *  again, and waitlists of events that are over cleared. Nothing for a paused business. */
export async function eventGuestSweep(db: any, tenantId: string, tenant: any, now = new Date()): Promise<{ reminded: number; promoted: number }> {
  const T = `tenants/${tenantId}`; const today = eventToday(tenant, now); let reminded = 0, promotedN = 0;
  if (accessLockOf(tenant).locked) return { reminded, promoted: promotedN };
  // Waitlists: each event with someone waiting; one that's over or canceled is cleared.
  const waits = await db.collection(`${T}/eventWaitlist`).get().catch(() => null);
  const byEvent = new Map<string, any[]>();
  for (const d of waits?.docs || []) { const e = String(d.data()?.eventId || ''); if (e) byEvent.set(e, [...(byEvent.get(e) || []), d]); }
  for (const [eventId, docs] of byEvent) {
    try {
      const evRef = db.doc(`${T}/studioEvents/${eventId}`);
      const ev0: any = (await evRef.get()).data();
      if (!ev0 || eventState(ev0, today) !== 'open') { for (const d of docs) await d.ref.delete().catch(() => undefined); continue; }
      if (!docs.some((d: any) => d.data()?.status !== 'moved')) continue;
      const r = await db.runTransaction(async (tx: any) => {
        const ev: any = (await tx.get(evRef)).data(); if (!ev) return { promoted: [] as Promoted[], ev: null };
        const list = (await tx.get(db.collection(`${T}/eventGuests`).where('eventId', '==', eventId))).docs.map((d: any) => d.data() || {});
        const p = await promoteFromWaitlist(tx, db, tenantId, eventId, ev, list.length, today, new Set(list.map((g: any) => lower(g.email)).filter(Boolean)));
        p.writes.forEach((w) => w());
        return { promoted: p.promoted, ev };
      });
      promotedN += r.promoted.length;
      if (r.ev) await tellPromoted(db, tenantId, tenant, r.ev, eventId, null, r.promoted);
    } catch (e: any) { console.error('[event-places] waitlist', tenantId, eventId, e?.message || e); }
  }
  // A promotion email that didn't go (moved off the waitlist more than five minutes ago, never told): tried again, up to
  // five times, while the event is still ahead.
  try {
    const leads = (await db.collection(`${T}/eventGuests`).where('source', '==', 'waitlist').get()).docs;
    const moved = leads.filter((d: any) => { const g = d.data() || {}; return g.partyLead && !g.notifiedAt && (Number(g.notifyTries) || 0) < 5 && now.getTime() - Date.parse(String(g.submittedAt || '')) > 5 * 60000; });
    for (const d of moved) {
      const g: any = d.data(); const ev: any = (await db.doc(`${T}/studioEvents/${g.eventId}`).get()).data();
      if (!ev || eventState(ev, today) !== 'open') { await d.ref.set({ notifyTries: 5 }, { merge: true }).catch(() => undefined); continue; }
      const places = leads.filter((x: any) => x.data()?.partyId === g.partyId).length || 1;
      const ok = await onListEmail(db, tenantId, tenant, ev, g.eventId, null, { name: g.name, email: g.email, places, partyId: g.partyId, how: 'waitlist' }, false);
      await d.ref.set(ok ? { notifiedAt: new Date().toISOString() } : { notifyTries: (Number(g.notifyTries) || 0) + 1 }, { merge: true }).catch(() => undefined);
    }
  } catch (e: any) { console.error('[event-places] promotion emails', tenantId, e?.message || e); }

  // Reminders: tomorrow's events, from the sending hour until 8pm the business's time.
  const zone = tenantTimeZone(tenant); const hour = hourIn(now, zone);
  const sendHour = Number.isFinite(Number(tenant?.clientNotify?.sendHour)) ? Math.min(19, Math.max(8, Math.round(Number(tenant.clientNotify.sendHour)))) : 9;
  if (tenant?.clientNotify?.enabled === false || hour < sendHour || hour >= 20) return { reminded, promoted: promotedN };
  const tomorrow = addDays(today, 1);
  const evs = await db.collection(`${T}/studioEvents`).where('date', '==', tomorrow).get().catch(() => null);
  for (const e of evs?.docs || []) {
    const ev: any = e.data() || {}; if (eventState(ev, today) !== 'open') continue;
    const guests = (await db.collection(`${T}/eventGuests`).where('eventId', '==', e.id).get()).docs;
    const meal = !orderBlock(ev, today) && !(await db.collection(`${T}/eventMenuItems`).where('eventId', '==', e.id).limit(1).get()).empty;
    for (const d of guests) {
      const g: any = d.data() || {};
      const lead = g.partyId ? g.partyLead === true : !!String(g.email || '').trim();
      if (!lead || g.reminderSentAt || !String(g.email || '').includes('@')) continue;
      // Claimed first, in one step, so two runs at once send it once; a claim whose send failed is let go for next time.
      const mine = await db.runTransaction(async (tx: any) => {
        const cur: any = (await tx.get(d.ref)).data() || {};
        if (cur.reminderSentAt || (cur.reminderClaimAt && now.getTime() - Date.parse(cur.reminderClaimAt) < 10 * 60000)) return false;
        tx.set(d.ref, { reminderClaimAt: now.toISOString() }, { merge: true }); return true;
      }).catch(() => false);
      if (!mine) continue;
      const party = g.partyId ? guests.filter((x: any) => x.data()?.partyId === g.partyId).length : 1;
      const link = g.partyId && !placeChangeBlock(ev, today) ? placeUrl(tenant, null, tenantId, e.id, g.partyId) : null;
      const title = titleOf(ev);
      const ok = await emailGuest(db, tenantId, tenant, ev, g.email, g.name, {
        subject: `See you tomorrow: ${title}`, heading: 'See you tomorrow',
        lines: [hi(g.name), `A reminder that ${title} is tomorrow${party > 1 ? `, and you have ${party} places under your name` : ''}.`,
          link ? 'If you can’t make it now, please cancel or give your place to a friend, so someone else can come.' : 'Just give your name at the door.'],
        cta: link ? { label: 'See or change your place', url: link } : null,
        secondary: meal && !g.mealChoiceId ? (() => { const m = mealUrl(tenant, null, tenantId, e.id); return m ? { label: 'Choose your meal', url: m } : null; })() : null,
      });
      await d.ref.set(ok ? { reminderSentAt: now.toISOString(), reminderClaimAt: null } : { reminderClaimAt: null }, { merge: true }).catch(() => undefined);
      if (ok) reminded++;
    }
  }
  return { reminded, promoted: promotedN };
}
