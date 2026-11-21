// src/lib/cook-ahead-server.ts — COOK AHEAD on the server (api/kitchen 'tickets'; lib/cook-ahead works it out). Reads a
// usual day like today: the same weekday, the last four weeks (the business's own day, lib/night-close-server), each
// day's kitchen tickets counted in 15-minute steps by the local clock (a dish's own ticket only, not a part made at
// another station: lib/dish-counts). A past day doesn't change, so its counts are worked out once and kept
// (tenants/{t}/private/cookAhead_{day}, a small document), and kept in memory a day. One read at a time per day however
// many screens ask, and a read that fails waits a minute. A day too busy to read whole is left out rather than counted
// in part. The kitchen screen never
// waits on it long: a first read that takes more than a moment shows next time.
import { addDays, nightBounds, tonight } from '@/lib/night-close-server';
import { tenantTimeZone, wallParts } from '@/lib/tenant-time';
import { cookAhead, SLOT_MIN, SLOTS, WEEKS, type CookBin, type CookItem, type CookPlan, type PastDay } from '@/lib/cook-ahead';

const PAGE = 4000, WAIT_MS = 1500, RETRY_MS = 60000;
const GONE = ['cancelled', 'voided', 'unpaid'];
const dayCache = new Map<string, { at: number; v: PastDay | null }>();
const reading = new Map<string, Promise<PastDay | null>>();
const failedAt = new Map<string, number>();

/** A day's tickets into steps (a dish's own ticket only), by the local clock. */
function countDay(docs: any[], tz: string): PastDay {
  const v: PastDay = {};
  for (const t of docs) {
    if (!t || GONE.includes(String(t.status)) || t.partOf) continue;
    const id = String(t.itemId || t.menuItemId || ''); const at = Date.parse(String(t.createdAt || '')); if (!id || !Number.isFinite(at)) continue;
    const w = wallParts(new Date(at), tz); const slot = Math.floor((w.hour * 60 + w.minute) / SLOT_MIN);
    if (slot < 0 || slot >= SLOTS) continue;
    (v[id] ||= Array.from({ length: SLOTS }, () => 0))[slot] += Math.max(1, Math.round(Number(t.quantity) || 1));
  }
  return v;
}

/** A day's tickets, all of them: in one read, or an hour at a time when there are more; null when even an hour is
 *  more than a read holds (left out, never counted in part). */
async function dayTickets(db: any, T: string, b: { start: string; end: string }): Promise<any[] | null> {
  const q = (from: string, to: string) => db.collection(`${T}/kdsTickets`).where('createdAt', '>=', from).where('createdAt', '<', to).limit(PAGE).get();
  const all = await q(b.start, b.end);
  if (all.size < PAGE) return all.docs.map((d: any) => d.data() || {});
  const out: any[] = []; const end = Date.parse(b.end);
  for (let h = Date.parse(b.start); h < end; h += 3600000) {
    const part = await q(new Date(h).toISOString(), new Date(Math.min(end, h + 3600000)).toISOString());
    if (part.size >= PAGE) return null;
    out.push(...part.docs.map((d: any) => d.data() || {}));
  }
  return out;
}

/** One past day's counts: kept in memory, else its stored summary, else worked out from its tickets (and stored). */
async function pastDay(db: any, T: string, tenant: any, day: string): Promise<PastDay | null> {
  const key = `${T}|${day}`;
  // (A day too busy to read whole is tried again in an hour, never stored.)
  const hit = dayCache.get(key); if (hit && Date.now() - hit.at < (hit.v ? 864e5 : 36e5)) return hit.v;
  if (Date.now() - (failedAt.get(key) || 0) < RETRY_MS) return null;
  const going = reading.get(key); if (going) return going;
  const p = (async () => {
    const ref = db.doc(`${T}/private/cookAhead_${day}`);
    const kept: any = (await ref.get()).data();
    let v: PastDay | null;
    if (kept && kept.slots && typeof kept.slots === 'object') {
      v = {};
      for (const [id, sparse] of Object.entries(kept.slots as Record<string, Record<string, number>>)) { const s = Array.from({ length: SLOTS }, () => 0); for (const [i, n] of Object.entries(sparse || {})) { const k = Number(i); if (k >= 0 && k < SLOTS) s[k] = Number(n) || 0; } v[id] = s; }
    } else {
      const tickets = await dayTickets(db, T, nightBounds(tenant, day));
      v = tickets ? countDay(tickets, tenantTimeZone(tenant)) : null;
      // Kept as steps with a count only (most are empty), so the document stays small.
      if (v) await ref.set({ day, slots: Object.fromEntries(Object.entries(v).map(([id, s]) => [id, Object.fromEntries(s.map((n, i) => [String(i), n]).filter(([, n]) => Number(n) > 0))])), at: new Date().toISOString() }).catch(() => null);
    }
    if (dayCache.size > 3000) dayCache.clear();
    dayCache.set(key, { at: Date.now(), v }); return v;
  })();
  reading.set(key, p);
  try { return await p; } catch (e) { failedAt.set(key, Date.now()); throw e; } finally { reading.delete(key); }
}

type Plan = Omit<CookPlan, 'byMin' | 'fromMin' | 'toMin'> & { by: string | null; from: string; to: string; weekday: string };

/** What to cook ahead now, for the items that can be held; the times as moments, and the business day's weekday. */
export async function cookAheadFor(db: any, T: string, tenant: any, items: CookItem[], bins: CookBin[], now = Date.now()): Promise<Plan[]> {
  if (!items.length) return [];
  const today = tonight(tenant, new Date(now)); const tz = tenantTimeZone(tenant);
  const days = (await Promise.all(Array.from({ length: WEEKS }, (_, i) => pastDay(db, T, tenant, addDays(today, -7 * (i + 1))).catch(() => null)))).filter((d): d is PastDay => !!d);
  const w = wallParts(new Date(now), tz); const nowMin = w.hour * 60 + w.minute;
  const at = (m: number) => new Date(now + (m - nowMin) * 60000).toISOString();
  // (The business day's own weekday: after midnight on a late night, it's still the day that began.)
  const weekday = new Date(`${today}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  return cookAhead(items, days, bins, nowMin, now).map(({ byMin, fromMin, toMin, ...p }) => ({ ...p, by: byMin === null ? null : at(byMin), from: at(fromMin), to: at(toMin), weekday }));
}

/** The same, but never holding the kitchen screen up: a first read that takes longer than a moment is left to finish
 *  (`keep` asks the host to let it, after the reply), and shows on the next poll. */
export async function cookAheadSoon(db: any, T: string, tenant: any, items: CookItem[], bins: CookBin[], now = Date.now(), keep?: (p: Promise<unknown>) => void): Promise<Plan[]> {
  if (!items.length) return [];
  const work = cookAheadFor(db, T, tenant, items, bins, now).catch(() => [] as Plan[]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((res) => { timer = setTimeout(() => res(null), WAIT_MS); });
  const got = await Promise.race([work, late]); clearTimeout(timer);
  if (got) return got;
  try { keep?.(work); } catch { /* (no host to ask: it finishes if it can) */ }
  return [];
}
