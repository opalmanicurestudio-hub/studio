// src/lib/timing-stats.ts — EVERY NIGHT: each provider's typical times, per service (and add-on mix), from the last 120 days.
// Only visits graded 'ok' count (real start and finish taps, not auto-closed, not tapped after paying, not wild outliers).
// Saved to tenants/{t}/timingStats/{staffId}__{serviceKey}, plus a whole-team figure per service from licensed staff only
// (all__{serviceKey}) — the yardstick for students and for suggesting a service's booked length. Shown once there are 5+.
// Renters' visits are never included: how an independent provider works is their own business.
import { visitTiming, spread } from '@/lib/timing';

const DAY = 86400000;
export async function buildTimingStats(db: any, tenantId: string, tenant: any, now = Date.now()) {
  const T = `tenants/${tenantId}`; const since = new Date(now - 120 * DAY).toISOString();
  const appts = (await db.collection(`${T}/appointments`).where('startTime', '>=', since).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }))
    .filter((a: any) => ['completed', 'paid'].includes(String(a.status || '')) || a.stage === 'complete');
  const services = (await db.collection(`${T}/services`).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
  const staff = new Map<string, any>((await db.collection(`${T}/staff`).get()).docs.map((d: any) => [d.id, { id: d.id, ...(d.data() || {}) }]));
  type Row = { staffId: string; serviceKey: string; serviceId: string; mins: number[]; recent: number[]; earlier: number[]; booked: number[]; onTime: number; overPast: number; clientCaused: number; ranBehind: number; isStudent: boolean };
  const groups = new Map<string, Row>(); let used = 0, skipped = 0;
  const add = (key: string, base: Omit<Row, 'mins' | 'recent' | 'earlier' | 'booked' | 'onTime' | 'overPast' | 'clientCaused' | 'ranBehind'>, tm: any, at: number, a: any) => {
    const g = groups.get(key) || { ...base, mins: [], recent: [], earlier: [], booked: [], onTime: 0, overPast: 0, clientCaused: 0, ranBehind: 0 }; groups.set(key, g);
    g.mins.push(tm.actualMinutes); (now - at <= 30 * DAY ? g.recent : g.earlier).push(tm.actualMinutes); g.booked.push(tm.bookedMinutes);
    if (tm.overPastGrace <= 0) g.onTime++; g.overPast += tm.overPastGrace;
    if (a.overReason?.clientCaused) g.clientCaused++; else if (a.overReason?.code === 'ran_behind') g.ranBehind++;
  };
  for (const a of appts) {
    const tm = visitTiming(a, services, tenant); if (tm.quality !== 'ok' || tm.actualMinutes === null || !tm.staffId) { skipped++; continue; }
    const st = staff.get(tm.staffId); if (!st || st.role === 'renter' || st.isRenter) continue;
    const at = Date.parse(a.startTime || '') || now; used++;
    add(`${tm.staffId}__${tm.serviceKey}`, { staffId: tm.staffId, serviceKey: tm.serviceKey, serviceId: String(a.serviceId || ''), isStudent: !!st.isStudent }, tm, at, a);
    if (!st.isStudent) add(`all__${tm.serviceKey}`, { staffId: 'all', serviceKey: tm.serviceKey, serviceId: String(a.serviceId || ''), isStudent: false }, tm, at, a);
  }
  const col = db.collection(`${T}/timingStats`); const keep = new Set<string>(); const nowIso = new Date(now).toISOString();
  let batch = db.batch(); let n = 0;
  for (const [key, g] of groups) {
    const id = key.replace(/[\/]/g, '_').slice(0, 400); keep.add(id); const s = spread(g.mins); const bookedTypical = spread(g.booked).median;
    batch.set(col.doc(id), { staffId: g.staffId, serviceKey: g.serviceKey, serviceId: g.serviceId, isStudent: g.isStudent, count: g.mins.length,
      typicalMinutes: s.median, rangeLow: s.low, rangeHigh: s.high, bookedMinutes: bookedTypical, onTimeRate: Math.round((g.onTime / g.mins.length) * 100) / 100,
      avgOverPastGrace: Math.round((g.overPast / g.mins.length) * 10) / 10, recentTypical: g.recent.length >= 3 ? spread(g.recent).median : null, earlierTypical: g.earlier.length >= 3 ? spread(g.earlier).median : null,
      clientCausedOverruns: g.clientCaused, ranBehindOverruns: g.ranBehind, updatedAt: nowIso });
    if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
  }
  for (const d of (await col.get()).docs) if (!keep.has(d.id)) { batch.delete(d.ref); if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); } }   // nothing recent → gone
  await batch.commit();
  return { groups: groups.size, used, skipped };
}
