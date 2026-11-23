// src/lib/bag-caught-server.ts — CAUGHT BEFORE IT WENT, read (server; lib/bag-caught; api/drive-live 'caught'). The
// orders handed over today, or in the last 7 or 30 days, at one location or all: read once a minute at most, whatever
// is asked, and added up by shift. Who okayed a PIN is for managers only.
import { atHere } from '@/lib/business-locations';
import { caughtReport, type CaughtReport } from '@/lib/bag-caught';
import { daypartsOf } from '@/lib/menu-time';
import { SPEED_RANGES, type SpeedRange } from '@/lib/speed';
import { addDays, endOfDay, startOfDay, todayIn } from '@/lib/tenant-time';

const cache = new Map<string, { at: number; v: any[] }>();
/** Only what the report reads of each order (lib/bag-caught: whether it went out, when, and what the check kept). */
const FIELDS = ['status', 'doneAt', 'channel', 'toGo', 'app', 'locationId', 'checks', 'bags', 'stickers'];
const slim = (o: any) => Object.fromEntries(FIELDS.filter((k) => o[k] !== undefined).map((k) => [k, k === 'app' ? { code: o.app?.code || null } : o[k]]));
/** The most orders read for one report (a busy month): past that, the newest. */
export const CAUGHT_MAX = 6000;

export async function caughtFor(db: any, tenantId: string, tenant: any, here: string | null, range: SpeedRange, tz: string, who: boolean, nowMs = Date.now()):
  Promise<CaughtReport & { range: SpeedRange; capped: boolean }> {
  const n = SPEED_RANGES.find((r) => r.id === range)?.days || 1;
  const today = todayIn(tz, new Date(nowMs));
  const from = startOfDay(addDays(today, -(n - 1)), tz).toISOString(), to = endOfDay(today, tz).toISOString();
  const key = `${tenantId}|${range}|${tz}|${today}`; const hit = cache.get(key);
  let orders: any[];
  if (hit && nowMs - hit.at < 60000) orders = hit.v;
  else {
    // (The newest first, so a stretch with more than the most read keeps its latest days.)
    const snap = await db.collection(`tenants/${tenantId}/counterOrders`).where('doneAt', '>=', from).where('doneAt', '<=', to).orderBy('doneAt', 'desc').select(...FIELDS).limit(CAUGHT_MAX).get();
    orders = snap.docs.map((d: any) => slim(d.data() || {}));
    cache.set(key, { at: nowMs, v: orders }); if (cache.size > 20) cache.delete(cache.keys().next().value as string);
  }
  const mine = orders.filter((o) => atHere(o, here));
  return { ...caughtReport(mine, daypartsOf(tenant), tz, { who }), range, capped: orders.length >= CAUGHT_MAX };
}
/** Forget what was read (a test, or right after a change that should show at once). */
export const forgetCaught = () => cache.clear();
