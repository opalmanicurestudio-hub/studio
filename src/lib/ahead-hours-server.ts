// src/lib/ahead-hours-server.ts — THE BUSINESS'S OPENING HOURS as they stand now (Settings, Opening hours; lib/ahead-hours),
// read at most once a minute per business: for ordering ahead (lib/counter-ahead) and each store's hours on the online
// shop (lib/shop-stores-server).
import { houseWeek } from '@/lib/ahead-hours';

const hoursCache = new Map<string, { at: number; week: Record<string, any> | null }>();
/** The house week itself (null: no hours set), for today's times and the days ahead (lib/ahead-days). */
export async function aheadWeek(db: any, tenantId: string, now = Date.now()): Promise<Record<string, any> | null> {
  const c = hoursCache.get(tenantId);
  if (c && now - c.at < 60000) return c.week;
  const snap = await db.collection(`tenants/${tenantId}/scheduleProfiles`).get().catch(() => null);
  // (Not readable just now: no limit this time, never a closed page because of a hiccup.)
  const week = snap ? houseWeek(snap.docs.map((d: any) => d.data() || {})) : null;
  if (snap) { hoursCache.set(tenantId, { at: now, week }); if (hoursCache.size > 500) hoursCache.delete(hoursCache.keys().next().value as string); }
  return week;
}
