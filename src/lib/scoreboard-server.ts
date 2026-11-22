// src/lib/scoreboard-server.ts — THE DRIVE-THRU SCOREBOARD, read on the server (lib/scoreboard; api/drive-live 'now'
// and 'goals'). Today's cars gone from the lane (handed over or left), read at most every 20 seconds per business and
// location however many screens watch; the best hour of the last 30 days from the kept days (lib/speed-server), read at
// most every half hour.
import { boardOf, goalsOf, type Board } from '@/lib/scoreboard';
import { targetsOf, atDriveThru } from '@/lib/counter-orders';
import { startOfDay, todayIn, addDays } from '@/lib/tenant-time';

const cache = new Map<string, { at: number; v: Board }>();
const dayCache = new Map<string, { at: number; v: { driveOffs: number; rank: Board['rank'] } }>();
const bestCache = new Map<string, { at: number; v: number | null; busy?: number }>();
/** A car moved: the hour is read afresh on the next look (api/counter forgetStats). Today's drive-offs and ranking keep
 *  their few minutes. */
export const forgetBoard = (tenantId: string) => { for (const k of Array.from(cache.keys())) if (k.startsWith(`${tenantId}|`)) cache.delete(k); };

/** The most drive-thru cars handed over in any one hour of the last 30 days, or null with none (lib/speed-server's kept
 *  days). Worked out in the background: the scoreboard never waits for it, and shows it once it's known. */
function bestHour(db: any, tenantId: string, tenant: any, here: string | null, tz: string, nowMs: number, later?: (work: () => Promise<void>) => void): number | null {
  const key = `${tenantId}|${here || ''}|${tz}`; const hit = bestCache.get(key);
  // (Being worked out already, unless that was a while ago and never finished.)
  if (hit && ((hit.busy && nowMs - hit.busy < 120000) || (!hit.busy && nowMs - hit.at < 30 * 60000))) return hit.v;
  bestCache.set(key, { at: hit?.at || 0, v: hit?.v ?? null, busy: nowMs });
  const work = async () => {
    const { speedDay } = await import('@/lib/speed-server'); const { STRIDE } = await import('@/lib/speed');
    const today = todayIn(tz, new Date(nowMs)); let best: number | null = null;
    const list = Array.from({ length: 30 }, (_, i) => addDays(today, -i));
    for (let i = 0; i < list.length; i += 6) {
      const days = await Promise.all(list.slice(i, i + 6).map((d) => speedDay(db, tenantId, tenant, here, d, tz, nowMs).catch(() => null)));
      for (const d of days) {
        // (By the hour each car was handed over, as "cars this hour" counts them.)
        const r = d?.ch?.drive?.r || []; const per = new Map<number, number>();
        for (let j = 0; j + STRIDE <= r.length; j += STRIDE) per.set(r[j + 2], (per.get(r[j + 2]) || 0) + 1);
        for (const n of Array.from(per.values())) best = Math.max(best ?? 0, n);
      }
    }
    bestCache.set(key, { at: Date.now(), v: best }); if (bestCache.size > 500) bestCache.delete(bestCache.keys().next().value as string);
  };
  const safe = () => work().catch(() => { bestCache.set(key, { at: Date.now(), v: hit?.v ?? null }); });
  // (After the answer is sent, as the host allows it to finish: api/drive-live passes next/server's after.)
  try { if (later) later(safe); else void safe(); } catch { void safe(); }
  return hit?.v ?? null;
}

/** The scoreboard now, at one location (`here`) or the whole business. */
export async function boardNow(db: any, tenantId: string, tenant: any, here: string | null, tz: string, o: { nowMs?: number; several?: boolean; later?: (work: () => Promise<void>) => void } = {}): Promise<Board> {
  const nowMs = o.nowMs ?? Date.now(); const key = `${tenantId}|${here || ''}|${tz}`; const hit = cache.get(key);
  if (hit && nowMs - hit.at < 20000) return hit.v;
  const now = new Date(nowMs); const today = todayIn(tz, now);
  // (The hour began on the hour, in the business's time: whole-hour zones and half-hour ones alike.)
  const mm = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, minute: 'numeric' }).format(now)) || 0;
  const hourStart = nowMs - (mm * 60000 + now.getUTCSeconds() * 1000 + now.getUTCMilliseconds());
  const T = `tenants/${tenantId}`; const goals = goalsOf(tenant, targetsOf(tenant)['drive-thru']);
  const { daypartNow } = await import('@/lib/menu-time');
  // This hour and the last: read on each look (a few dozen cars).
  const hourSnap = await db.collection(`${T}/driveThruCars`).where('goneAt', '>=', new Date(hourStart - 3600000).toISOString()).limit(1500).get();
  const v = boardOf({ gone: hourSnap.docs.map((d: any) => d.data() || {}).filter(atDriveThru), here, hourStart, nowMs, best: bestHour(db, tenantId, tenant, here, tz, nowMs, o.later), goals, daypart: daypartNow(tenant, now)?.name || null, several: !!o.several });
  // Today's drive-offs and the ranking: every car today, read every few minutes.
  const dk = `${key}|${today}`; let day = dayCache.get(dk);
  if (!day || nowMs - day.at > 3 * 60000) {
    const snap = await db.collection(`${T}/driveThruCars`).where('goneAt', '>=', startOfDay(today, tz).toISOString()).limit(4000).get();
    const t = boardOf({ gone: snap.docs.map((d: any) => d.data() || {}).filter(atDriveThru), here, hourStart, nowMs, best: null, goals, daypart: null, several: !!o.several });
    day = { at: nowMs, v: { driveOffs: t.driveOffs, rank: t.rank } };
    dayCache.set(dk, day); if (dayCache.size > 500) dayCache.delete(dayCache.keys().next().value as string);
  }
  const out: Board = { ...v, driveOffs: day.v.driveOffs, rank: day.v.rank };
  cache.set(key, { at: nowMs, v: out }); if (cache.size > 500) cache.delete(cache.keys().next().value as string);
  return out;
}
