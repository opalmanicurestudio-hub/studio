// src/lib/capacity-check.ts — GIVE NEW ORDERS MORE TIME BY ITSELF, for a shop that turned it on (Setup → Capacity; off
// unless it is). Checked every ten minutes with the order alerts (api/cron/order-alerts): when a coming ship day has more
// to pack than the team can ship (lib/capacity), new orders get one more day through a short busy period, the same one
// the "Give new orders one more day" suggestion adds, so dates already promised stay as they are. Once that day is
// caught up, nothing more is added and the period ends by itself. The people who run the shop see it in the app.
import { dayKey, tenantTimeZone } from './tenant-time';
import { busyWithRoom, normalizeSchedule, scheduleFrom, type BusyPeriod } from './ship-promise';
import { CAPACITY_DAYS, dayLoads, overDays, overTitle, packedOn, suggestionsFor, teamCapacity, type TeamCapacity } from './capacity';

export type CapacityRun = { added: boolean; day?: string };

export async function checkCapacity(db: any, tenantId: string, tenant: any, opts: { now?: number } = {}): Promise<CapacityRun> {
  const rs = tenant?.retailSettings || {};
  const schedule = scheduleFrom(rs);
  if (!schedule.savedAt || !schedule.capacity.autoMoreTime) return { added: false };
  const tz = tenantTimeZone(tenant);
  const now = opts.now ?? Date.now();
  const today = dayKey(new Date(now), tz);
  // Someone ended one by hand today: none goes back on until tomorrow.
  if (schedule.capacity.pausedOn === today) return { added: false };
  // Already giving new orders more time: nothing to add while one is on or still to come.
  if (schedule.busy.some((b) => b.auto === 'more_time' && b.to >= today)) return { added: false };
  const T = `tenants/${tenantId}`;

  // The team's capacity, worked out once a day and kept with the day's record.
  const dayRef = db.doc(`${T}/private/capacity-${today}`);
  const rec: any = (await dayRef.get()).data() || {};
  let team: TeamCapacity | null = rec.teamAt ? (rec.team || null) : null;
  // Read every check for today's packed count; the capacity itself is worked out once a day.
  const since = new Date(now - (rec.teamAt ? 1 : CAPACITY_DAYS + 1) * 86_400_000).toISOString();
  const packedSnap = await db.collection(`${T}/retailOrders`).where('packedAt', '>=', since).orderBy('packedAt', 'desc').limit(1500).get();
  const packed = packedSnap.docs.map((d: any) => d.data() || {});
  if (!rec.teamAt) {
    team = teamCapacity(packed, now, tz);
    await dayRef.set({ team, teamAt: new Date(now).toISOString() }, { merge: true }).catch(() => {});
  }
  const openSnap = await db.collection(`${T}/retailOrders`).where('stage', 'in', ['paid', 'picking', 'packed']).limit(1000).get();
  const open = openSnap.docs.map((d: any) => ({ ...(d.data() || {}), id: d.id }));
  // The first coming day over capacity that one more day for new orders would help (today, in a rush, often can't be).
  let pick: { over: ReturnType<typeof overDays>[number]; period: BusyPeriod; detail: string } | null = null;
  for (const over of overDays(dayLoads(open, rs, tz, schedule, now, team, 5, packedOn(packed, today, tz)))) {
    const more = suggestionsFor(over, schedule, now, tz, team).find((x) => x.kind === 'more_time');
    if (more && more.kind === 'more_time') { pick = { over, period: more.period, detail: more.detail }; break; }
  }
  if (!pick) return { added: false };
  const chosen = pick;

  // Added in a transaction against the saved schedule, so two checks at once add it once.
  const tRef = db.doc(`tenants/${tenantId}`);
  const added = await db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(tRef)).data() || {};
    const s = scheduleFrom(cur.retailSettings || {});
    if (!s.capacity.autoMoreTime || s.capacity.pausedOn === today || s.busy.some((b) => b.auto === 'more_time' && b.to >= today)) return false;
    // Room made the same way a manager's change makes it: old ones that ended make way, never one still to come.
    const keep = busyWithRoom(s.busy, today);
    if (!keep) return false;
    const next = normalizeSchedule({ ...s, busy: [...keep, chosen.period] });
    if (!next.busy.some((b) => b.id === chosen.period.id)) return false;
    tx.update(tRef, { 'retailSettings.shipSchedule.busy': JSON.parse(JSON.stringify(next.busy)), 'retailSettings.shipSchedule.savedAt': new Date(now).toISOString() });
    return true;
  }).catch(() => false);
  if (!added) return { added: false };
  const over = chosen.over;
  const more = chosen;

  // In the app (not a buzz) for the people who run the shop.
  const staffSnap = await db.collection(`${T}/staff`).get();
  const people = staffSnap.docs.map((d: any) => ({ ...(d.data() || {}), id: d.id }))
    .filter((m: any) => m.archived !== true && (['owner', 'admin'].includes(String(m.role || '').toLowerCase()) || String(m.fulfilmentRole || '').toLowerCase() === 'manager'));
  if (people.length) {
    const b = db.batch(); const at = new Date(now).toISOString();
    for (const m of people) {
      const r = db.collection(`${T}/notifications`).doc();
      b.set(r, { id: r.id, userId: m.id, type: 'orders_capacity', title: 'New orders get one more day', message: `${overTitle(over, today, tz)}, so ${more.detail.charAt(0).toLowerCase()}${more.detail.slice(1)}`, link: '/retail-orders/capacity', createdAt: at, read: false });
    }
    await b.commit().catch(() => {});
  }
  return { added: true, day: over.day };
}
