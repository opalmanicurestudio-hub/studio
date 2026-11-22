// src/lib/speed-server.ts — SPEED OF SERVICE, read on the server (lib/speed; api/drive-live 'speed'; the long wait alert
// from api/counter's lane and Drive-thru live).
// - A day: every guest handed over that day (tenants/{t}/driveThruCars by goneAt, counterOrders placed ahead by doneAt,
//   and the shop's curbside orders by completedAt), kept small once the day is well over
//   (tenants/{t}/private/speed_{location or all}_{day}), so a month is read in thirty small reads.
// - The report: today, the last 7 days or the last 30, for one kind of guest, at one location or the whole business.
// - The long wait alert: a car in the drive-thru past the business's limit buzzes the shift lead's phone once
//   (lib/tell-managers), with where it is and what the kitchen's still making.
import { dayOf, speedReport, carRec, aheadRec, shopCurbRec, SPEED_DAY_VERSION, CURB_TARGET, AHEAD_TARGET, longWaitOf, type SpeedCh, type SpeedDay, type SpeedRange, type SpeedRec, type SpeedReport, SPEED_RANGES } from '@/lib/speed';
import { targetsOf, atDriveThru, inLineNow } from '@/lib/counter-orders';
import { atHere } from '@/lib/business-locations';
import { addDays, endOfDay, startOfDay, todayIn } from '@/lib/tenant-time';
import { clock } from '@/lib/drive-live';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
/** A day is kept once it's been over this long (a car handed over just after midnight belongs to the next day anyway). */
const KEEP_AFTER_MS = 2 * 3600000;

/** The hour (0 to 23) of a moment in a time zone. */
export function hourIn(tz: string): (ms: number) => number {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' });
  return (ms: number) => { const h = Number(f.format(new Date(ms))); return Number.isFinite(h) ? h % 24 : 0; };
}
const weekdayOf = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
const first = (v: unknown) => { const s = String(v ?? '').trim().split(/\s+/)[0]; return s ? Array.from(s).slice(0, 24).join('') : null; };

/** One day's guests, at one location (`here`) or the whole business: kept once the day is well over. */
const dayCache = new Map<string, { at: number; v: SpeedDay }>();
export async function speedDay(db: any, tenantId: string, tenant: any, here: string | null, day: string, tz: string, nowMs = Date.now()): Promise<SpeedDay> {
  const T = `tenants/${tenantId}`; const keepRef = db.doc(`${T}/private/speed_${here || 'all'}_${day}`);
  // (A day not kept yet, today above all, is read at most once a minute, whichever guests and days are asked for.)
  const ck = `${tenantId}|${here || ''}|${day}|${tz}`; const hit = dayCache.get(ck);
  if (hit && nowMs - hit.at < 60000) return hit.v;
  const kept: any = (await keepRef.get()).data();
  if (kept && kept.v === SPEED_DAY_VERSION) return kept as SpeedDay;
  const from = startOfDay(day, tz).toISOString(), to = endOfDay(day, tz).toISOString(); const hourOf = hourIn(tz);
  const shopOn = tenant?.modules?.retail === true;
  const [cars, orders, shop] = await Promise.all([
    db.collection(`${T}/driveThruCars`).where('goneAt', '>=', from).where('goneAt', '<=', to).limit(5000).get(),
    // (Only the orders placed ahead, for that day: the counter's own are its cars above.)
    db.collection(`${T}/counterOrders`).where('day', '==', day).where('channel', '==', 'ahead').limit(3000).get(),
    shopOn ? db.collection(`${T}/retailOrders`).where('completedAt', '>=', from).where('completedAt', '<=', to).limit(2000).get() : Promise.resolve({ docs: [] }),
  ]);
  const recs: SpeedRec[] = [
    ...cars.docs.map((d: any) => d.data() || {}).filter((c: any) => atHere(c, here)).map((c: any) => carRec(c, hourOf)),
    ...orders.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((o: any) => atHere(o, here)).map((o: any) => aheadRec(o, hourOf)),
    ...shop.docs.map((d: any) => d.data() || {}).filter((o: any) => atHere(o, here)).map((o: any) => shopCurbRec(o, hourOf)),
  ].filter((x): x is SpeedRec => !!x);
  // (A guest who got here before midnight and was served after counts in the day they were served, but in no hour: never
  // in another weekday's late hour.)
  const dayOfMs = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  for (const x of recs) if (dayOfMs(x.startMs) !== day) x.hour = -1;
  // (The guests' first names, for the longest waits only.)
  const named = Array.from(new Set((['drive', 'counter'] as SpeedCh[]).flatMap((ch) => recs.filter((x) => x.ch === ch && x.orderId && ID.test(x.orderId)).sort((a, b) => b.sec - a.sec).slice(0, 10).map((x) => x.orderId!))));
  if (named.length) {
    const snaps = await db.getAll(...named.map((id) => db.doc(`${T}/counterOrders/${id}`)));
    const names = new Map<string, string | null>(snaps.map((s: any) => [s.id, first((s.data?.() || {}).guestName)]));
    for (const x of recs) if (x.orderId && names.has(x.orderId)) x.name = names.get(x.orderId) || null;
  }
  const out = dayOf(day, weekdayOf(day), recs, (ms) => new Date(ms).toISOString());
  // Kept once the day is well over, without guests' names (they're looked up again when shown: speedFor).
  if (nowMs - Date.parse(to) > KEEP_AFTER_MS) {
    const bare: SpeedDay = { ...out, ch: Object.fromEntries(Object.entries(out.ch).map(([k, c]) => [k, { ...c, long: c.long.map((w) => ({ ...w, name: null })) }])) as SpeedDay['ch'] };
    await keepRef.set(bare).catch(() => null);
    return bare;
  }
  dayCache.set(ck, { at: nowMs, v: out }); if (dayCache.size > 500) dayCache.delete(dayCache.keys().next().value as string);
  return out;
}

const cache = new Map<string, { at: number; v: SpeedReport }>();
/** The report: one kind of guest, over today, 7 days or 30, at one location or the whole business (read at most once a
 *  minute for the same one). */
export async function speedFor(db: any, tenantId: string, tenant: any, here: string | null, ch: SpeedCh, range: SpeedRange, tz: string, nowMs = Date.now()): Promise<SpeedReport> {
  const key = `${tenantId}|${here || ''}|${ch}|${range}|${tz}`; const hit = cache.get(key);
  if (hit && nowMs - hit.at < 60000) return hit.v;
  const today = todayIn(tz, new Date(nowMs)); const n = SPEED_RANGES.find((r) => r.id === range)?.days || 1;
  const list = Array.from({ length: n }, (_, i) => addDays(today, -i));
  const days: SpeedDay[] = [];
  // (A few days at a time: the first month read is the slowest, then each day is kept.)
  for (let i = 0; i < list.length; i += 6) days.push(...(await Promise.all(list.slice(i, i + 6).map((d) => speedDay(db, tenantId, tenant, here, d, tz, nowMs)))));
  const t = targetsOf(tenant);
  const target = ch === 'drive' ? t['drive-thru'] : ch === 'counter' ? t.counter : ch === 'curb' ? CURB_TARGET : AHEAD_TARGET;
  const v = speedReport(days, ch, range, target);
  // (The names of those who waited longest, looked up as they're shown: a kept day keeps none.)
  const ids = Array.from(new Set(v.long.filter((w) => !w.name && w.orderId && ID.test(w.orderId)).map((w) => w.orderId!)));
  if (ids.length) {
    const snaps = await db.getAll(...ids.map((id) => db.doc(`tenants/${tenantId}/counterOrders/${id}`))).catch(() => [] as any[]);
    const names = new Map<string, string | null>(snaps.map((x: any) => [x.id, first((x.data?.() || {}).guestName)]));
    v.long = v.long.map((w) => (w.orderId && names.get(w.orderId) ? { ...w, name: names.get(w.orderId)! } : w));
  }
  if (v.longest && !v.longest.name) v.longest = v.long.find((w) => w.orderId === v.longest!.orderId && w.at === v.longest!.at) || v.longest;
  cache.set(key, { at: nowMs, v }); if (cache.size > 500) cache.delete(cache.keys().next().value as string);
  return v;
}

// ── THE LONG WAIT ALERT ─────────────────────────────────────────────────────────────────────────────────────────────
const leadsCache = new Map<string, { at: number; leads: { id: string; at: string[] }[]; fallback: boolean }>();
/** Who runs the shift: the team's shift leads and managers (by their job, or a manager's role) at the car's location
 *  (or at every location, when they're not set to some); when there are none at all, the people who run the business
 *  (lib/tell-managers). */
async function shiftLeads(db: any, tenantId: string, tenant: any, nowMs: number, at: string | null): Promise<string[]> {
  let hit = leadsCache.get(tenantId);
  if (!hit || nowMs - hit.at >= 5 * 60000) {
    const snap = await db.collection(`tenants/${tenantId}/staff`).limit(500).get().catch(() => ({ docs: [] as any[] }));
    const on = (s: any) => s && s.isActive !== false && s.archived !== true && s.status !== 'archived';
    const leads = snap.docs.filter((d: any) => { const s = d.data() || {}; return on(s) && ID.test(d.id) && (['shift_lead', 'manager'].includes(String(s.job || '')) || String(s.role || '') === 'manager'); })
      .map((d: any) => ({ id: d.id, at: Array.isArray((d.data() || {}).locationIds) ? (d.data() || {}).locationIds.map(String) : [] }));
    hit = { at: nowMs, leads, fallback: !leads.length };
    leadsCache.set(tenantId, hit); if (leadsCache.size > 500) leadsCache.delete(leadsCache.keys().next().value as string);
  }
  const here = hit.leads.filter((l) => !at || !l.at.length || l.at.includes(at)).map((l) => l.id);
  if (here.length) return here;
  const { managerIds } = await import('@/lib/tell-managers');
  return managerIds(db, tenantId, tenant);
}
const STAGE_WORDS: Record<string, string> = { speaker: 'still ordering', pay: 'on the way to pay', pickup: 'at the pickup window', forward: 'parked' };

/** Cars in the drive-thru past the business's limit, each told once: the shift lead's phone buzzes with the car, how
 *  long, where it is and what the kitchen is still making (`making`: by car, when the caller has read it). Several at
 *  once are one notice. Never throws. */
export async function checkLongWaits(db: any, tenantId: string, tenant: any, cars: any[], nowMs = Date.now(), making: Map<string, string[]> = new Map()): Promise<number> {
  try {
    const limit = longWaitOf(tenant); if (!limit) return 0;
    const late = cars.filter((c: any) => c && ID.test(String(c.id || '')) && atDriveThru(c) && ['speaker', 'pay', 'pickup', 'forward'].includes(String(c.stage)) && !c.waitTold && inLineNow([c], nowMs) === 1
      && nowMs - Date.parse(String(c.arrivedAt || '')) >= limit * 1000).slice(0, 10);
    if (!late.length) return 0;
    const ref = (c: any) => db.doc(`tenants/${tenantId}/driveThruCars/${c.id}`);
    // (Once for each car, however many screens are watching.)
    const mine: any[] = [];
    for (const c of late) if (await db.runTransaction(async (tx: any) => { const x: any = (await tx.get(ref(c))).data(); if (!x || x.waitTold || x.stage === 'gone') return false; tx.set(ref(c), { waitTold: new Date(nowMs).toISOString() }, { merge: true }); return true; }).catch(() => false)) mine.push(c);
    if (!mine.length) return 0;
    const { tellManagers } = await import('@/lib/tell-managers');
    const line = (c: any) => { const sec = Math.round((nowMs - Date.parse(String(c.arrivedAt))) / 1000); const what = making.get(String(c.id)) || [];
      const where = c.stage === 'forward' && c.spot ? `parked in spot ${c.spot}` : STAGE_WORDS[String(c.stage)] || 'in the lane';
      return { sec, text: `${String(c.number || 'A car')} has waited ${clock(sec)} at the drive-thru, ${where}${what.length ? `, waiting on ${what.slice(0, 2).join(' and ')}` : ''}` }; };
    // By location (each location's own shift leads); more than two at once there: one notice for them all.
    const byAt = new Map<string, any[]>(); for (const c of mine) { const k = String(c.locationId || ''); byAt.set(k, [...(byAt.get(k) || []), c]); }
    let told = 0;
    for (const [at, list] of Array.from(byAt.entries())) {
      const ids = await shiftLeads(db, tenantId, tenant, nowMs, at || null);
      // (Each notice with the cars it's about.)
      const notices: { message: string; cars: any[] }[] = list.length > 2
        ? [{ message: `${list.length} cars have waited over ${clock(limit)} at the drive-thru: ${list.map((c) => `${String(c.number || 'a car')} ${clock(line(c).sec)}`).join(', ')}.`, cars: list }]
        : list.map((c) => ({ message: `${line(c).text}.`, cars: [c] }));
      for (const x of notices) {
        const n = await tellManagers(db, tenantId, tenant, { type: 'drive_wait', message: x.message, link: '/drive-live', priority: 'high' }, { to: ids });
        // (Not written: its cars are tried again on the next look. Nobody to tell: not.)
        if (n < 0) { for (const c of x.cars) await ref(c).set({ waitTold: null }, { merge: true }).catch(() => null); continue; }
        if (n > 0) told += x.cars.length;
      }
    }
    return told;
  } catch (e: any) { console.error('[speed] long wait not told', e?.message); return 0; }
}
