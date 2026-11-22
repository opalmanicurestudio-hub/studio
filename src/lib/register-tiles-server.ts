// src/lib/register-tiles-server.ts — THE REGISTER'S MOST SOLD NOW, read on the server (lib/register-tiles mostSoldOf;
// api/counter 'lane', for the counter and the drive-thru lane screen). From the last three weeks of the business's
// menuSales (one small document a day, counted as orders are sent: lib/counter-server soldCounts), read at most every
// ten minutes per business however many screens poll, and worked out again when the hour turns.
import { createHash } from 'crypto';
import { hourIn, todayIn } from '@/lib/tenant-time';
import { mostSoldOf, MOST_DAYS } from '@/lib/register-tiles';

const cache = new Map<string, { at: number; days: Record<string, unknown>[] }>();
const READ_EVERY_MS = 10 * 60000;
// (Worked out from those days once a minute per business, hour and menu, not on every look.)
const listCache = new Map<string, { at: number; v: string[] }>();

/** What sells at this hour at the business, most sold first, among `menuIds` (null when the days couldn't be read). */
export async function mostSoldNow(db: any, tenantId: string, tz: string, menuIds: string[], now = new Date()): Promise<string[] | null> {
  const key = `${tenantId}|${tz}`; let hit = cache.get(key);
  if (!hit || now.getTime() - hit.at > READ_EVERY_MS) {
    // (The business's days by date, counted back from today's: a short or long day at a clock change skips none.)
    const noon = Date.parse(`${todayIn(tz, now)}T12:00:00Z`);
    const days = Array.from({ length: MOST_DAYS }, (_, k) => new Date(noon - k * 86400000).toISOString().slice(0, 10));
    const snaps: any[] | null = await db.getAll(...days.map((d) => db.doc(`tenants/${tenantId}/menuSales/${d}`))).catch((e: any) => { console.error('[register] most sold not read', e?.message); return null; });
    if (!snaps) return hit ? mostSoldOf(hit.days, hourIn(now, tz), new Set(menuIds)) : null;
    hit = { at: now.getTime(), days: snaps.map((s: any) => (s?.data?.() || {}) as Record<string, unknown>) };
    cache.set(key, hit); if (cache.size > 500) cache.delete(cache.keys().next().value as string);
  }
  const hour = hourIn(now, tz); const lk = `${key}|${hour}|${hit.at}|${menuIds.length}|${createHash('sha1').update(menuIds.join(',')).digest('base64url').slice(0, 16)}`; const done = listCache.get(lk);
  if (done && now.getTime() - done.at < 60000) return done.v;
  const v = mostSoldOf(hit.days, hour, new Set(menuIds));
  listCache.set(lk, { at: now.getTime(), v }); if (listCache.size > 500) listCache.delete(listCache.keys().next().value as string);
  return v;
}
