// src/lib/event-night-server.ts — an event's night, put together (lib/event-night): its run of show (saved on the event
// as runOfShow, or a first one worked out from its start and courses), where the night is, how the courses are going
// from the kitchen's tickets, and the prep from the guests' choices. Read by api/event-night.
import { chartTables } from '@/lib/event-guest-link';
import { seatMap, seatPickingOf, seatsInUse } from '@/lib/event-seats';
import { isPaidEvent } from '@/lib/event-tickets';
import { tenantTimeZone, wallParts, dayKey } from '@/lib/tenant-time';
import { readTime } from '@/lib/event-block';
import { cleanShow, coursePacing, eventPrep, nightState, pushLater, startOfShow, suggestShow, toHM, toMin, type Moment } from '@/lib/event-night';

/** The manifest's own names for the courses, so the two read the same. */
const LABELS: Record<number, string> = { 1: 'Starters', 2: 'Mains', 3: 'Desserts' };
export const clock = (hm: string) => { const m = /^(\d{2}):(\d{2})$/.exec(hm); if (!m) return hm; const h = Number(m[1]); const ap = h >= 12 ? 'pm' : 'am'; const h12 = h % 12 || 12; return Number(m[2]) ? `${h12}:${m[2]} ${ap}` : `${h12} ${ap}`; };
const startOf = (ev: any) => { const t = readTime(ev?.time); return t ? toHM(t[0] * 60 + t[1]) : null; };

/** Is it the event's night on the business's clock (an evening that started yesterday carries on until 6 am), and the
 *  minutes now on the night's own count (past midnight, over 24 hours). */
function nightOf(ev: any, tz: string) {
  const now = new Date(); const w = wallParts(now, tz); const today = dayKey(now, tz);
  const yesterday = dayKey(new Date(now.getTime() - 86400000), tz);
  const live = !['cancelled', 'completed'].includes(String(ev?.status || ''));
  const d = String(ev?.date || '');
  if (live && d === today) return { on: true, nowMin: w.hour * 60 + w.minute };
  const begin = readTime(ev?.time);
  if (live && d === yesterday && w.hour < 6 && begin && begin[0] >= 18) return { on: true, nowMin: 1440 + w.hour * 60 + w.minute };
  return { on: false, nowMin: w.hour * 60 + w.minute };
}

/** The event and what its night needs. The kitchen's tickets and the fires are read only on the night. A read that
 *  fails throws, so a fired course never looks unfired. */
async function read(db: any, T: string, eventId: string, tz: string, all = false) {
  const evSnap = await db.doc(`${T}/studioEvents/${eventId}`).get();
  if (!evSnap.exists) return null;
  const ev: any = { id: eventId, ...(evSnap.data() || {}) };
  const night = nightOf(ev, tz);
  const q = (c: string, n: number) => db.collection(`${T}/${c}`).where('eventId', '==', eventId).limit(n).get().then((s: any) => s.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })));
  const want = night.on || all;
  const [menu, guests, fires, tickets] = await Promise.all([q('eventMenuItems', 200), q('eventGuests', 1500), want ? q('courseFires', 100) : [], night.on ? q('kdsTickets', 3000) : []]);
  const items = menu.map((m: any) => ({ id: String(m.id), name: String(m.name || 'Dish'), courseNumber: Number(m.courseNumber) || 1 }));
  const courses: number[] = Array.from(new Set<number>(items.map((m: any) => m.courseNumber))).sort((a, b) => a - b);
  return { ev, night, items, courses, guests, fires: fires.filter((f: any) => f.status === 'fired' && f.isDelta !== true), tickets };
}

const showOf = (ev: any, courses: number[]): { show: Moment[]; saved: boolean; start: number } => {
  const begin = startOf(ev);
  const saved = Array.isArray(ev.runOfShow) ? cleanShow(ev.runOfShow, courses, { kept: true, start: begin ? toMin(begin) : null }) : null;
  const show = saved || suggestShow(begin, courses.map((n) => ({ n, name: LABELS[n] || `Course ${n}` })));
  return { show, saved: !!saved, start: startOfShow(begin, show) };
};

// Kept a few seconds, so everyone with the event open reads it once; let go when the run of show changes.
const KEEP_MS = 15000;
const kept = new Map<string, { at: number; p: Promise<any> }>();
export function forgetNight(T: string, eventId: string) { kept.delete(`${T}|${eventId}`); }

/** `fresh`: something just changed here (a course fired from the manifest), so read it again now. */
export function eventNightFor(db: any, T: string, tenant: any, eventId: string, fresh = false) {
  const key = `${T}|${eventId}`; const now = Date.now();
  for (const [k, v] of Array.from(kept.entries())) if (now - v.at > KEEP_MS) kept.delete(k);
  // Fresh at most every 3 seconds, so nobody can make it read the whole event over and over.
  const hit = kept.get(key); if (hit && (!fresh || now - hit.at < 3000)) return hit.p;
  const mine = { at: now, p: build(db, T, tenant, eventId) };
  mine.p.catch(() => { if (kept.get(key) === mine) kept.delete(key); });
  kept.set(key, mine); return mine.p;
}

async function build(db: any, T: string, tenant: any, eventId: string) {
  const tz = tenantTimeZone(tenant);
  const r = await read(db, T, eventId, tz); if (!r) return null;
  const { ev, night, items, courses, guests, fires, tickets } = r;
  const { show, saved, start } = showOf(ev, courses);
  const fired = new Map<number, string>(); for (const f of fires) { const n = Number(f.courseNumber); const at = String(f.firedAt || ''); if (!fired.has(n) || at < fired.get(n)!) fired.set(n, at); }
  // A course's name on the night: what the run of show calls it, or the manifest's.
  const names: Record<number, string> = {}; for (const n of courses) names[n] = show.find((m) => m.course === n)?.what || LABELS[n] || `Course ${n}`;
  const state = night.on ? nightState(show, fired, night.nowMin, start) : null;
  const pacing = night.on ? coursePacing({ courses, names, fires: fires.map((f: any) => ({ courseNumber: Number(f.courseNumber), firedAt: String(f.firedAt || '') })),
    tickets: tickets.filter((t: any) => Number(t.courseNumber) > 0).map((t: any) => ({ courseNumber: Number(t.courseNumber), status: String(t.status || ''), readyAt: t.readyAt || null, deliveredAt: t.deliveredAt || null, carriedAt: t.carriedAt || null })), show, nowMin: night.nowMin, start, clock }) : null;
  return {
    event: { id: eventId, title: String(ev.title || ev.name || 'Event').slice(0, 80), date: String(ev.date || ''), time: startOf(ev), status: String(ev.status || 'upcoming') },
    show, saved, courses: courses.map((n) => ({ n, name: LABELS[n] || `Course ${n}` })), fired: Array.from(fired.keys()),
    onTheNight: night.on, now: toHM(night.nowMin), state, pacing, prep: eventPrep(guests, items),
    // Seats chosen online when buying tickets (lib/event-seats): the seating chart's seats, and how many are taken.
    seats: (() => { const chart = chartTables(ev); const total = chart.reduce((a, t) => a + t.seats.length, 0); const sp = seatPickingOf(ev);
      const taken = seatMap(ev, seatsInUse(guests, [])).reduce((n, t) => n + t.seats.filter((x) => x.state === 'taken').length, 0);
      return { paid: isPaidEvent(ev), chart: total > 0, total, taken, on: sp.on, wholeTables: sp.wholeTables }; })(),
  };
}

/** Whether guests choose their seats when they buy tickets, and may buy a whole table. Only with a seating chart. */
export async function saveSeatPicking(db: any, T: string, eventId: string, on: boolean, wholeTables: boolean): Promise<'ok' | 'missing' | 'no_chart'> {
  const snap = await db.doc(`${T}/studioEvents/${eventId}`).get(); if (!snap.exists) return 'missing';
  if (on && !chartTables(snap.data()).some((t) => t.seats.length)) return 'no_chart';
  await db.doc(`${T}/studioEvents/${eventId}`).set({ seatPicking: { on, wholeTables: on && wholeTables } }, { merge: true });
  forgetNight(T, eventId); return 'ok';
}

/** The run of show, as a manager set it (null when it doesn't make sense). */
export async function saveShow(db: any, T: string, tenant: any, eventId: string, raw: unknown, by: string): Promise<Moment[] | null | 'missing'> {
  const r = await read(db, T, eventId, tenantTimeZone(tenant)); if (!r) return 'missing';
  const begin = startOf(r.ev);
  const show = cleanShow(raw, r.courses, { start: begin ? toMin(begin) : null }); if (!show) return null;
  await db.doc(`${T}/studioEvents/${eventId}`).set({ runOfShow: show, runOfShowBy: by.slice(0, 60), runOfShowAt: new Date().toISOString() }, { merge: true });
  forgetNight(T, eventId);
  return show;
}

/** Everything still to come on the night, `minutes` later. */
export async function pushShow(db: any, T: string, tenant: any, eventId: string, minutes: number, by: string): Promise<Moment[] | 'missing'> {
  const r = await read(db, T, eventId, tenantTimeZone(tenant), true); if (!r) return 'missing';
  const fired = new Set<number>(r.fires.map((f: any) => Number(f.courseNumber)));
  const ref = db.doc(`${T}/studioEvents/${eventId}`);
  // Read again inside the transaction, so two pushes at once both count.
  const moved = await db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(ref)).data() || {};
    const { show, start } = showOf(cur, r.courses);
    const next = pushLater(show, r.night.nowMin, fired, minutes, start);
    tx.set(ref, { runOfShow: next, runOfShowBy: by.slice(0, 60), runOfShowAt: new Date().toISOString() }, { merge: true });
    return next;
  });
  forgetNight(T, eventId);
  return moved;
}

