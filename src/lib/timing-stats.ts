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
  const clientSuggestions = await buildClientTimingSuggestions(db, T, appts, services, staff, groups, tenant, now).catch(() => ({ suggested: 0, cleared: 0 }));
  return { groups: groups.size, used, skipped, ...clientSuggestions };
}

// A CLIENT'S OWN TIME — suggestions, never changes. For each properly timed visit (same grading as above), compare what the
// client actually took with that provider's typical time for the service (or the service's standard length when the
// provider has fewer than 5 timed visits), so a slow provider never makes a client look slow. Suggest only when the client
// has 3+ such visits, the typical difference is 10+ minutes, and at least two-thirds lean the same way; skip it when it's
// already set (within 10 minutes) or a manager dismissed the same suggestion in the last 90 days. Students' and renters'
// visits are left out. Saved on the client as timingSuggestions: { [serviceId]: { extra, visits, at } } for a manager to
// accept or dismiss — nothing about their bookings or price changes until someone does.
/** The true median (even counts average the two middle values). */
function trueMedian(xs: number[]) { const v = [...xs].sort((a, b) => a - b); const m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; }

async function buildClientTimingSuggestions(db: any, T: string, appts: any[], services: any[], staff: Map<string, any>, _groups: Map<string, any>, tenant: any, now: number) {
  // How long this provider takes for this service with EVERYONE ELSE — the client's own visits are left out, so a client who
  // always runs long can't pull the yardstick up and hide their own difference.
  const byProvider = new Map<string, { clientId: string; mins: number }[]>();
  for (const a of appts) { const tm = visitTiming(a, services, tenant); if (tm.quality !== 'ok' || tm.actualMinutes === null || !tm.staffId) continue;
    const st = staff.get(tm.staffId); if (!st || st.role === 'renter' || st.isRenter || st.isStudent) continue;
    const k = `${tm.staffId}__${tm.serviceKey}`; const l = byProvider.get(k) || []; l.push({ clientId: String(a.clientId || ''), mins: tm.actualMinutes }); byProvider.set(k, l); }
  const providerTypical = (staffId: string, serviceKey: string, clientId: string) => { const others = (byProvider.get(`${staffId}__${serviceKey}`) || []).filter((x) => x.clientId !== clientId).map((x) => x.mins); return others.length >= 5 ? spread(others).median : null; };
  const standard = (a: any) => { const svc = services.find((s: any) => s.id === a.serviceId); return (Number(svc?.duration) || 60) + (Array.isArray(a.addOnIds) ? a.addOnIds : []).reduce((m: number, id: string) => m + (Number(services.find((s: any) => s.id === id)?.duration) || 0), 0); };
  const byClient = new Map<string, Map<string, number[]>>();
  for (const a of appts) {
    if (!a.clientId || !a.serviceId) continue;
    const tm = visitTiming(a, services, tenant); if (tm.quality !== 'ok' || tm.actualMinutes === null || !tm.staffId) continue;
    const st = staff.get(tm.staffId); if (!st || st.role === 'renter' || st.isRenter || st.isStudent) continue;
    const expected = providerTypical(tm.staffId, tm.serviceKey, String(a.clientId)) ?? standard(a);
    const m = byClient.get(a.clientId) || new Map<string, number[]>(); byClient.set(a.clientId, m);
    const list = m.get(String(a.serviceId)) || []; list.push(tm.actualMinutes - expected); m.set(String(a.serviceId), list);
  }
  const nowIso = new Date(now).toISOString(); let suggested = 0, cleared = 0; let batch = db.batch(); let n = 0;
  const flush = async () => { if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); } };
  const touched = new Set<string>();
  for (const [clientId, perService] of byClient) {
    const ref = db.doc(`${T}/clients/${clientId}`); const c: any = (await ref.get()).data(); if (!c) continue;
    const prev: Record<string, any> = c.timingSuggestions || {}; const next: Record<string, any> = {};
    for (const [serviceId, deltas] of perService) {
      if (deltas.length < 3) continue;
      const med = trueMedian(deltas); const extra = Math.round(med / 5) * 5; if (Math.abs(extra) < 10) continue;   // a true middle: never leans upward on a price
      const leaning = deltas.filter((d) => (extra > 0 ? d >= 5 : d <= -5)).length; if (leaning / deltas.length < 2 / 3) continue;
      const current = Number(c.timing?.services?.[serviceId]?.extra ?? c.timing?.all ?? 0); if (Math.abs(extra - current) < 10) continue;
      const p = prev[serviceId]; if (p?.dismissedAt && now - Date.parse(p.dismissedAt) < 90 * DAY && Math.abs(Number(p.dismissedExtra) - extra) < 10) { next[serviceId] = p; continue; }
      next[serviceId] = { extra, visits: deltas.length, at: nowIso };
    }
    const fresh = Object.values(next).filter((x: any) => !x.dismissedAt).length; suggested += fresh;
    // update (not a merge) REPLACES the whole map, so suggestions with no recent evidence disappear.
    if (Object.keys(next).length || Object.keys(prev).length) { batch.update(ref, { timingSuggestions: next, hasTimingSuggestion: fresh > 0 }); touched.add(clientId); await flush(); }
  }
  for (const d of (await db.collection(`${T}/clients`).where('hasTimingSuggestion', '==', true).get()).docs) {
    if (touched.has(d.id)) continue; batch.update(d.ref, { timingSuggestions: {}, hasTimingSuggestion: false }); cleared++; await flush();   // no recent evidence any more
  }
  await batch.commit();
  return { suggested, cleared };
}
