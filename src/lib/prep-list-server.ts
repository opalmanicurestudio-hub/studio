// src/lib/prep-list-server.ts — TOMORROW'S PREP LIST, on the server (api/prep). Reads the usual nights (each night's
// kitchen and counter tickets, the guests seated, the guests booked), the day's bookings (lib/table-booking-server), the
// menu and its recipes' ingredients; lib/prep-list works it out. Worked out at most every ten minutes a day a business.
// What the kitchen has ticked off as done is kept with the day (prepLists/{day}).
import { addDays, nightBounds, tonight, DAY_RE } from '@/lib/night-close-server';
import { usedByItem } from '@/lib/dish-counts';
import { isMenuItem } from '@/lib/menu-server';
import { recipeOf } from '@/lib/menu-stock';
import { stationOfItem, stationsOf } from '@/lib/table-service';
import { planPrep, PREP_WEEKS, usualNights, type Night, type PrepPlan } from '@/lib/prep-list';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
export const PREP_AHEAD = 7;
const TICKETS = 4000;

const nightCache = new Map<string, { at: number; v: Night }>();
const planCache = new Map<string, { at: number; v: PrepPlan }>();
export const forgetPrep = (T: string) => { for (const k of planCache.keys()) if (k.startsWith(`${T}|`)) planCache.delete(k); };

/** One night as it went: what was sold of each item, the guests seated, the guests booked. A past night doesn't change,
 *  so it's kept a day. */
async function nightOf(db: any, T: string, tenant: any, day: string): Promise<Night> {
  const key = `${T}|${day}`; const hit = nightCache.get(key); if (hit && Date.now() - hit.at < 864e5) return hit.v;
  const b = nightBounds(tenant, day);
  // (A read that fails throws: a night is never kept as empty because a read didn't go through.)
  const [k, l, ses, bk] = await Promise.all([
    db.collection(`${T}/kdsTickets`).where('createdAt', '>=', b.start).where('createdAt', '<', b.end).limit(TICKETS).get(),
    db.collection(`${T}/refreshmentRequests`).where('requestedAt', '>=', b.start).where('requestedAt', '<', b.end).limit(TICKETS).get(),
    db.collection(`${T}/serviceSessions`).where('businessDay', '==', day).limit(10).get(),
    db.collection(`${T}/tableBookings`).where('day', '==', day).limit(400).get(),
  ]);
  const tickets = [...k.docs.map((d: any) => d.data() || {}).filter((t: any) => String(t.createdAt || '') < b.end),
    ...l.docs.map((d: any) => d.data() || {}).filter((t: any) => String(t.requestedAt || '') < b.end)];
  const used: Record<string, number> = {}; for (const [id, q] of usedByItem(tickets)) used[id] = q;
  let guests: number | null = null;
  for (const s of ses.docs) {
    const p = await db.collection(`${T}/parties`).where('sessionId', '==', s.id).limit(800).get();
    const n = p.docs.map((d: any) => d.data() || {}).filter((x: any) => ['seated', 'finished'].includes(String(x.status)) || !!x.seatedAt).reduce((a: number, x: any) => a + Math.max(1, Math.round(num(x.size) || 1)), 0);
    guests = (guests || 0) + n;
  }
  const booked = bk.docs.map((d: any) => d.data() || {}).filter((x: any) => ['booked', 'no_show'].includes(String(x.status))).reduce((a: number, x: any) => a + Math.max(1, Math.round(num(x.size) || 1)), 0);
  const v: Night = { day, guests: guests && guests > 0 ? guests : null, booked, used, truncated: k.docs.length >= TICKETS || l.docs.length >= TICKETS };
  if (nightCache.size > 3000) nightCache.clear();
  nightCache.set(key, { at: Date.now(), v }); return v;
}

/** The day a prep list can be for: tomorrow, or any day this coming week (today included). */
export function prepDays(tenant: any, now = new Date()): string[] {
  const today = tonight(tenant, now);
  return Array.from({ length: PREP_AHEAD + 1 }, (_, i) => addDays(today, i));
}

/** The prep list for a day (tomorrow when none is asked for), with what's been ticked off. */
export async function prepFor(db: any, T: string, tenant: any, asked?: string | null, o: { fresh?: boolean; now?: Date } = {}) {
  const now = o.now || new Date(); const days = prepDays(tenant, now);
  const day = asked && DAY_RE.test(asked) && days.includes(asked) ? asked : days[1];
  const key = `${T}|${day}`; const hit = planCache.get(key);
  let plan: PrepPlan;
  // Worked out again when asked, but not more than once a minute.
  if (hit && Date.now() - hit.at < (o.fresh ? 60000 : 600000)) plan = hit.v;
  else {
    // The same day of the week, the last six weeks; the last week's nights too, in case there aren't two of those.
    const today = days[0];
    const want = new Set<string>();
    for (let w = 1; w <= PREP_WEEKS; w++) { const d = addDays(day, -7 * w); if (d < today) want.add(d); }
    let nights = await Promise.all(Array.from(want).map((d) => nightOf(db, T, tenant, d)));
    if (usualNights(day, nights).basis !== 'weekday') {
      const recent = Array.from({ length: 7 }, (_, i) => addDays(today, -(i + 1))).filter((d) => !want.has(d));
      nights = [...nights, ...(await Promise.all(recent.map((d) => nightOf(db, T, tenant, d))))];
    }
    const [menu, bk] = await Promise.all([
      db.collection(`${T}/inventory`).where('type', '==', 'refreshment').limit(500).get(),
      db.collection(`${T}/tableBookings`).where('day', '==', day).limit(400).get(),
    ]);
    const stations = stationsOf(tenant);
    const items = menu.docs.map((d: any) => ({ id: d.id, x: d.data() || {} })).filter((r: any) => isMenuItem(r.x))
      .map((r: any) => ({ id: r.id, name: String(r.x.name || 'Item').replace(/\s+/g, ' ').trim().slice(0, 60), station: stationOfItem(r.x, stations), x: r.x }));
    const partIds: string[] = Array.from(new Set<string>(items.flatMap((it: any) => recipeOf(it.x, it.id).map((l) => l.id)))).filter((id) => ID.test(id)).slice(0, 300);
    const parts = new Map<string, any>();
    for (let i = 0; i < partIds.length; i += 100) {
      const snaps = await db.getAll(...partIds.slice(i, i + 100).map((id) => db.doc(`${T}/inventory/${id}`)));
      for (const s of snaps) if (s.exists) parts.set(s.id, s.data() || {});
    }
    const live = bk.docs.map((d: any) => d.data() || {}).filter((x: any) => x.status === 'booked');
    plan = planPrep({ day, nights, items, booked: live.reduce((a: number, x: any) => a + Math.max(1, Math.round(num(x.size) || 1)), 0), bookings: live.length, stations, parts, now: now.getTime() });
    if (planCache.size > 500) planCache.clear();
    planCache.set(key, { at: Date.now(), v: plan });
  }
  const marks: any = (await db.doc(`${T}/prepLists/${day}`).get().catch(() => null))?.data?.() || {};
  return { ...plan, days, done: marks.done && typeof marks.done === 'object' ? marks.done : {} };
}

/** A dish on the day's list ticked off as prepped (or not), by whom, and how many it said then (a late booking can
 *  make it more). */
export async function markPrep(db: any, T: string, tenant: any, day: string, itemId: string, done: boolean, by: string, make?: number | null) {
  if (!DAY_RE.test(day) || !prepDays(tenant).includes(day) || !ID.test(itemId)) return { ok: false as const, error: 'Pick a dish on the list.' };
  if (done && !isMenuItem((await db.doc(`${T}/inventory/${itemId}`).get()).data())) return { ok: false as const, error: 'That isn’t a dish on the menu.' };
  const n = make === null || make === undefined ? NaN : Math.round(Number(make)); const at = Number.isFinite(n) && n >= 0 && n < 100000 ? n : null;
  const ref = db.doc(`${T}/prepLists/${day}`);
  await db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(ref)).data() || {};
    const marks = { ...(cur.done || {}) };
    if (done) marks[itemId] = { by: String(by).slice(0, 60), at: new Date().toISOString(), make: at }; else delete marks[itemId];
    tx.set(ref, { day, done: marks, updatedAt: new Date().toISOString() });
  });
  return { ok: true as const };
}
