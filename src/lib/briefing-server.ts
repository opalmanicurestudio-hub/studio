// src/lib/briefing-server.ts — the pre-shift briefing for a day, put together (lib/briefing): the guests expected and
// when (lib/prep-list's usual night, the bookings, an event's guests), staffing against the schedule, the bookings worth
// knowing (lib/guest-memory for regulars, when the business remembers them), the prep still to do, what's sold out
// (tonight only), who's working, and the manager's note with who has read it (tenants/{t}/briefings/{day}, written here
// only; the team can't write it from the browser, firestore.rules). The guests, staffing and bookings are kept for a
// minute, so the whole team opening it before a shift reads the business once; the kitchen for 15 seconds; the note and
// who has read it are read every time.
import { prepDays, prepFor } from '@/lib/prep-list-server';
import { readMenu } from '@/lib/menu-server';
import { memorySettingsOf } from '@/lib/guest-memory';
import { guestFor, memoriesFor } from '@/lib/guest-memory-server';
import { floorSettingsOf } from '@/lib/table-stage';
import { tenantTimeZone, wallToUtc } from '@/lib/tenant-time';
import { shiftWindow, LIVE } from '@/lib/shift-check';
import { allergyPhrase } from '@/lib/allergens';
import { readTime } from '@/lib/event-block';
import { arrivals, bookingsToKnow, inHouse, jobOf, JOB_WORD, staffingGaps, staffingOf, staffingRows, type EventIn, type Job, type ShiftIn } from '@/lib/briefing';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const first = (n: unknown) => String(n || '').trim().split(/\s+/)[0] || 'Team member';
const clip = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export const MAX_NOTE = 1000;
const KEEP_MS = 60000; const KITCHEN_MS = 15000;
const kept = new Map<string, { at: number; p: Promise<any> }>();
const keptKitchen = new Map<string, { at: number; p: Promise<any> }>();
/** Let go of what's kept for a business (its staffing numbers changed). */
export function forgetBriefing(T: string) { for (const m of [kept, keptKitchen]) for (const k of Array.from(m.keys())) if (k.startsWith(`${T}|`)) m.delete(k); }
/** Kept for `ms`, the same promise to everyone asking meanwhile; a failure isn't kept, and nothing is held past its time. */
function keep(m: Map<string, { at: number; p: Promise<any> }>, key: string, ms: number, make: () => Promise<any>): Promise<any> {
  const now = Date.now();
  for (const [k, v] of Array.from(m.entries())) if (now - v.at > ms) m.delete(k);
  const hit = m.get(key); if (hit) return hit.p;
  const mine = { at: now, p: make() }; mine.p.catch(() => { if (m.get(key) === mine) m.delete(key); });
  m.set(key, mine); return mine.p;
}

/** The words of a name, for telling whether a booking and a guest on file are the same person (not a title or "party"). */
const NOT_NAMES = new Set(['mr', 'mrs', 'ms', 'mx', 'miss', 'dr', 'the', 'and', 'of', 'party', 'family', 'table', 'group', 'guest']);
const nameWords = (v: unknown) => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z]+/).filter((w) => w.length >= 2 && !NOT_NAMES.has(w));

/** An event's guests that night: those who have a place (reserved or with a ticket). A private party from a quote,
 *  often held somewhere else, isn't counted on the floor. */
const eventGuests = (e: any) => Math.max(Number(e.rsvpCount) || 0, Number(e.ticketsSold) || 0);

async function build(db: any, T: string, tenant: any, day: string, tonight: boolean) {
  const tz = tenantTimeZone(tenant);
  const p: any = await prepFor(db, T, tenant, day);
  const [bk, ev, sh, staffSnap] = await Promise.all([
    db.collection(`${T}/tableBookings`).where('day', '==', day).limit(400).get(),
    // Events (studioEvents) keep their day as the business's own date and their start as its own clock time.
    db.collection(`${T}/studioEvents`).where('date', '==', day).limit(50).get().catch(() => ({ docs: [] })),
    db.collection(`${T}/shifts`).where('date', '==', day).limit(200).get(),
    db.collection(`${T}/staff`).get(),
  ]);
  const staff = new Map<string, any>(staffSnap.docs.map((d: any) => [d.id, d.data() || {}]));
  const bookings = bk.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((b: any) => b.status === 'booked' && /^\d{2}:\d{2}$/.test(String(b.time || '')))
    .sort((a: any, b: any) => String(a.time).localeCompare(String(b.time)));
  const listed = ev.docs.map((d: any) => d.data() || {})
    .filter((e: any) => !['cancelled', 'completed'].includes(String(e.status || '')) && eventGuests(e) > 0)
    .map((e: any) => { const hm = readTime(e.time); const len = Number(e.durationMinutes) > 0 ? Number(e.durationMinutes) : Number(e.durationHours) > 0 ? Number(e.durationHours) * 60 : 180;
      return { title: clip(e.title || e.name, 80) || 'Event', time: hm ? `${String(hm[0]).padStart(2, '0')}:${String(hm[1]).padStart(2, '0')}` : '', guests: eventGuests(e),
        startHour: hm ? hm[0] : -1, endHour: hm ? Math.min(24, Math.max(hm[0] + 1, Math.ceil(hm[0] + (hm[1] + len) / 60))) : -1 }; })
    .sort((a: any, b: any) => a.time.localeCompare(b.time));
  // Only an event with a start time is placed in the evening's hours.
  const events: EventIn[] = listed.filter((e: any) => e.startHour >= 0).map((e: any) => ({ startHour: e.startHour, endHour: e.endHour, guests: e.guests }));
  // Guests, hour by hour: the booked, the event, and walk-ins the way a usual night came in.
  const arr = arrivals({ bookings: bookings.map((b: any) => ({ time: b.time, size: Number(b.size) || 1 })), events, hours: p.hours, walkIns: p.walkIns });
  const fs = floorSettingsOf(tenant); const stay = fs.turnMid;
  const nonEvent = arr.all.map((x, h) => x - arr.event[h]);
  const house = inHouse(nonEvent, stay, events);
  // The kitchen: guests coming in each hour, an event's spread over its hours.
  const kitchen = nonEvent.slice(); for (const e of events) { const n = Math.max(1, e.endHour - e.startHour); for (let h = e.startHour; h < Math.min(24, e.startHour + n); h++) kitchen[h] += e.guests / n; }
  // Who's on: the day's published work shifts.
  const dayStart = wallToUtc(day, 0, 0, tz).getTime();
  const shifts: (ShiftIn & { from: string; to: string })[] = sh.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((x: any) => LIVE(x) && (!x.kind || x.kind === 'work') && x.status !== 'draft')
    .map((x: any) => { const w = shiftWindow(x, tz); const m = staff.get(String(x.staffId)); if (!w || !m || m.archived === true || m.isRenter === true || m.role === 'renter') return null;
      return { staffId: String(x.staffId), name: first(m.name || m.displayName), job: jobOf(m), start: w.start, end: w.end, from: String(x.startTime), to: String(x.endTime) }; })
    .filter(Boolean).sort((a: any, b: any) => a.start - b.start || a.name.localeCompare(b.name)) as any[];
  // A bar or a host is counted on a night someone doing that job is on the schedule (a quiet night may have neither).
  const hasJob = new Set<Job>(shifts.map((x) => x.job));
  const S = staffingOf(tenant);
  const rows = staffingRows({ arrive: nonEvent, house, kitchenLoad: kitchen, shifts, s: S, dayStart, hasJob });
  const gaps = staffingGaps(rows);
  // Bookings worth knowing: regulars (when the business remembers its guests) by their number or email, only where the
  // name on file shares a name with the booking (a parent's number on a grown child's booking finds the parent). Where
  // it's someone else in the family (another first name), only the allergy, the careful side, with whose it is.
  const mem = memorySettingsOf(tenant);
  const who: Record<string, { id: string; onFile: string | null }> = {};
  if (mem.on) {
    const look = bookings.slice(0, 40);
    for (let i = 0; i < look.length; i += 8) {
      const found = await Promise.all(look.slice(i, i + 8).map((b: any) => guestFor(db, T, { phone: b.phone, email: b.email }).catch(() => null)));
      found.forEach((g, j) => { const b: any = look[i + j]; if (!g) return;
        const mine = nameWords(b.name); const theirs = nameWords(g.name);
        if (!mine.length || !theirs.some((w) => mine.includes(w))) return;
        who[b.id] = { id: g.id, onFile: mine[0] !== theirs[0] ? clip(g.name, 60) : null }; });
    }
  }
  const ids = Array.from(new Set(Object.values(who).map((x) => x.id)));
  const memories = ids.length ? await memoriesFor(db, T, tenant, ids).catch(() => ({} as Record<string, any>)) : {};
  const toKnow = bookingsToKnow(bookings.map((b: any) => { const w = who[b.id]; const m: any = w ? (memories as any)[w.id] : null;
    const theirs = !w?.onFile;
    return { time: b.time, name: clip(b.name, 60) || 'Guest', size: Number(b.size) || 1, asks: Array.isArray(b.asks) ? b.asks.map((x: any) => clip(x, 30)) : [], note: b.note ? clip(b.note, 140) : null,
      visits: theirs ? m?.visits || 0 : 0, usual: theirs ? (m?.usual || []).map((u: any) => clip(u.name, 40)) : [], allergy: m?.allergy ? [(m.allergy.keys || []).length ? allergyPhrase(m.allergy.keys, !!m.allergy.severe).replace(/^an? /, '') : '', m.allergy.other ? clip(m.allergy.other, 60) : ''].filter(Boolean).join(', ') || null : null,
      teamNote: theirs && m?.note?.text ? clip(m.note.text, 140) : null, onFile: m && w?.onFile ? w.onFile : null }; }));
  const peak = rows.reduce((best: any, r) => (!best || r.guests > best.guests ? r : best), null);
  return {
    guests: { expected: p.guests, booked: p.booked, bookings: p.bookings, walkIns: p.walkIns, usual: p.usualGuests, basis: p.basis, eventGuests: listed.reduce((a: number, e: any) => a + e.guests, 0),
      byHour: rows.filter((r) => r.guests > 0).map((r) => ({ hour: r.hour, guests: r.guests })), peak: peak && peak.guests > 0 ? peak.hour : null, walkInsByHour: arr.placed },
    staffing: { rows, short: gaps.short, over: gaps.over, shortHours: gaps.shortHours, settings: S, unknown: shifts.filter((x) => x.job === 'other').map((x) => x.name), stayMin: stay },
    working: shifts.map((x) => ({ staffId: x.staffId, name: x.name, job: JOB_WORD[x.job], from: x.from, to: x.to })),
    events: listed.map((e: any) => ({ title: e.title, time: e.time, guests: e.guests })),
    toKnow,
  };
}

/** The kitchen: prep still to do, and (tonight) what's sold out or nearly; kept only a few seconds, it moves in service. */
async function kitchenFor(db: any, T: string, tenant: any, day: string, tonight: boolean) {
  const p: any = await prepFor(db, T, tenant, day);
  const done: Record<string, any> = p.done || {};
  const prepRows = (p.rows || []).filter((r: any) => !r.isNew && r.make);
  const prepLeft = prepRows.filter((r: any) => !done[r.id]);
  let soldOut: string[] = []; let low: string[] = [];
  if (tonight) { const menu = await readMenu(db, T.split('/')[1]).catch(() => []); const live = menu.filter((m) => m.onMenu);
    soldOut = live.filter((m) => m.soldOut || !m.inStock).map((m) => m.name).slice(0, 12);
    low = live.filter((m) => !m.soldOut && m.inStock && m.canMake !== null && m.canMake > 0 && m.canMake <= 3).map((m) => `${m.name} ${m.canMake}`).slice(0, 8); }
  return { prepTotal: prepRows.length, prepLeft: prepLeft.length, prepNames: prepLeft.slice(0, 8).map((r: any) => `${r.name} ${r.make}`), soldOut, low };
}

export async function briefingFor(db: any, T: string, tenant: any, asked: string | null, me: { id: string; name: string }) {
  const days = prepDays(tenant); const day: string = asked && days.slice(0, 2).includes(asked) ? asked : days[0];
  const tonight = day === days[0];
  const key = `${T}|${day}|${tonight}|${JSON.stringify(staffingOf(tenant))}|${memorySettingsOf(tenant).on}`;
  const [base, kitchen, noteSnap] = await Promise.all([
    keep(kept, key, KEEP_MS, () => build(db, T, tenant, day, tonight)),
    keep(keptKitchen, `${T}|${day}|${tonight}`, KITCHEN_MS, () => kitchenFor(db, T, tenant, day, tonight)),
    db.doc(`${T}/briefings/${day}`).get(),
  ]);
  const note: any = noteSnap.exists ? noteSnap.data() || {} : {};
  const readBy: Record<string, { name: string; at: string }> = note.readBy && typeof note.readBy === 'object' ? note.readBy : {};
  const working: { staffId: string; name: string }[] = base.working;
  const team = Array.from(new Set(working.map((x) => x.staffId)));
  return {
    day, days: days.slice(0, 2), tonight, ...base, kitchen,
    note: note.text ? { text: String(note.text), by: String(note.by || ''), at: String(note.at || '') } : null,
    read: { mine: !!readBy[me.id], names: team.filter((id) => readBy[id]).map((id) => first(readBy[id].name)), notYet: team.filter((id) => !readBy[id]).map((id) => working.find((x) => x.staffId === id)?.name || 'Team member'), others: Object.keys(readBy).filter((id) => !team.includes(id)).length },
  };
}

/** The manager's note for the day (empty clears it). */
export async function saveNote(db: any, T: string, day: string, text: string, by: string) {
  const t = clip(text, MAX_NOTE);
  await db.doc(`${T}/briefings/${day}`).set({ day, text: t || null, by, at: new Date().toISOString() }, { merge: true });
}
/** "Got it": who has read the day's briefing. */
export async function markRead(db: any, T: string, day: string, me: { id: string; name: string }) {
  if (!ID.test(me.id)) return;
  await db.doc(`${T}/briefings/${day}`).set({ day, readBy: { [me.id]: { name: clip(me.name, 60), at: new Date().toISOString() } } }, { merge: true });
}
