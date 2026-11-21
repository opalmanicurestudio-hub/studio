// src/lib/lane-entry-server.ts — THE LANE ENTRY SENSOR AND THE LINE NOW, on the server (lib/lane-entry works it out).
// - The sensor's link (api/counter/lane-entry): a manager makes one per lane on the Menu page; it's shown once, and only
//   its fingerprint is kept (tenants/{t}/private/laneSensors, which no browser can read). Making a new one stops the old.
// - Each car it counts: tenants/{t}/private/laneEntry_{lane}, the counts of the last 20 minutes and when the line was
//   last said to be clear.
// - The line now (lineNow): cars in the lane, those waiting to order, whether it's a rush, and the orders being taken at
//   a speaker, read once every few seconds for the business however many screens ask.
import { createHash, randomBytes } from 'crypto';
import { addEntry, waitingByLane, isRush, earlyLines, ENTRY_KEEP_MS, type EntryLog, type EarlyLine } from '@/lib/lane-entry';
import { lanesOf, cleanLane } from '@/lib/drive-lanes';
import { inLineNow, atDriveThru } from '@/lib/counter-orders';

const hash = (k: string) => createHash('sha256').update(String(k)).digest('hex');
const LIVE = ['speaker', 'pay', 'pickup', 'forward'];
type Sensor = { lane: 1 | 2; createdAt: string; createdBy: string; lastAt?: string | null };

/** The lanes' sensors, for the Menu page: which are set up, and when each last counted a car (never the link). */
export async function sensorsView(db: any, tenantId: string, _tenant?: any): Promise<{ lane: 1 | 2; on: boolean; lastAt: string | null }[]> {
  const s: any = (await db.doc(`tenants/${tenantId}/private/laneSensors`).get()).data() || {};
  const by = new Map<number, Sensor>(Object.values((s.tokens || {}) as Record<string, Sensor>).map((x) => [x.lane, x]));
  // (Both lanes, so the page shows lane 2's at once when two lanes are turned on.)
  return ([1, 2] as const).map((l) => ({ lane: l, on: by.has(l), lastAt: (s.last || {})[String(l)] || null }));
}

/** A new link for a lane's sensor (the old one, if any, stops): its key, shown once. */
export async function newSensor(db: any, tenantId: string, lane: 1 | 2, by: string): Promise<string> {
  const key = randomBytes(24).toString('hex');
  const ref = db.doc(`tenants/${tenantId}/private/laneSensors`);
  await db.runTransaction(async (tx: any) => {
    const s: any = (await tx.get(ref)).data() || {};
    const tokens: Record<string, Sensor> = Object.fromEntries(Object.entries((s.tokens || {}) as Record<string, Sensor>).filter(([, v]) => v?.lane !== lane));
    tokens[hash(key)] = { lane, createdAt: new Date().toISOString(), createdBy: String(by).slice(0, 80) };
    // (Its count starts now, empty, so the lane screen shows the line from the first car.)
    const eRef = db.doc(`tenants/${tenantId}/private/laneEntry_${lane}`); const e = (await tx.get(eRef)).data();
    tx.set(ref, { tokens, last: s.last || {} });
    if (!e) tx.set(eRef, { at: [], clearedAt: new Date().toISOString() });
  });
  forget(tenantId);
  return key;
}

/** A lane's sensor turned off: its link stops counting. */
export async function stopSensor(db: any, tenantId: string, lane: 1 | 2): Promise<void> {
  const ref = db.doc(`tenants/${tenantId}/private/laneSensors`);
  await db.runTransaction(async (tx: any) => {
    const s: any = (await tx.get(ref)).data() || {};
    tx.set(ref, { tokens: Object.fromEntries(Object.entries((s.tokens || {}) as Record<string, Sensor>).filter(([, v]) => v?.lane !== lane)), last: s.last || {} });
    // (Its count goes with it: the lane screen stops showing a line it can't see.)
    tx.delete(db.doc(`tenants/${tenantId}/private/laneEntry_${lane}`));
  });
  forget(tenantId);
}

/** A car passed the sensor whose key this is: counted in its lane (the same car seen twice in a moment, once). */
export async function sensorCar(db: any, tenantId: string, key: string, nowMs = Date.now()): Promise<{ ok: true; lane: 1 | 2; counted: boolean } | { ok: false }> {
  if (!/^[a-f0-9]{48}$/.test(key) || !/^[A-Za-z0-9_-]{1,160}$/.test(tenantId)) return { ok: false };
  const sRef = db.doc(`tenants/${tenantId}/private/laneSensors`);
  const s: any = (await sRef.get()).data();
  const me: Sensor | undefined = s?.tokens?.[hash(key)];
  const lane = cleanLane(me?.lane); if (!lane) return { ok: false };
  const ref = db.doc(`tenants/${tenantId}/private/laneEntry_${lane}`);
  const counted = await db.runTransaction(async (tx: any) => {
    // (Its link read again with the count: one turned off this instant never starts a count again.)
    const [still, log] = await Promise.all([tx.get(sRef), tx.get(ref)]);
    if (cleanLane((still.data() as any)?.tokens?.[hash(key)]?.lane) !== lane) return false;
    const r = addEntry(log.data() as EntryLog | undefined, nowMs);
    if (r.counted) tx.set(ref, r.log);
    return r.counted;
  });
  // (When it last counted a car, for the Menu page: kept to the half minute, so a chattering sensor isn't a write a call.)
  if (!(nowMs - (Date.parse(String(s?.last?.[String(lane)] || '')) || 0) < 30000)) await sRef.set({ last: { [String(lane)]: new Date(nowMs).toISOString() } }, { merge: true }).catch(() => null);
  forget(tenantId);
  return { ok: true, lane, counted };
}

/** "Line's clear" on the lane screen: nobody waiting to order, in one lane or both. */
export async function lineClear(db: any, tenantId: string, lane: 1 | 2 | null, nowMs = Date.now()): Promise<void> {
  // (Only a lane with a sensor has a count to clear: one with none never starts to look as if it had one.)
  await Promise.all(([1, 2] as const).filter((l) => !lane || l === lane).map(async (l) => {
    const ref = db.doc(`tenants/${tenantId}/private/laneEntry_${l}`);
    if ((await ref.get()).exists) await ref.set({ clearedAt: new Date(nowMs).toISOString() }, { merge: true });
  }));
  forget(tenantId);
}

export type EarlyOrder = { orderId: string; number: string; lane: 1 | 2 | null; since: string; lines: EarlyLine[] };
export type LineNow = { inLane: number; waiting: number; byLane: Record<1 | 2, number>; sensor: boolean; rush: boolean; ordering: EarlyOrder[] };

const cache = new Map<string, { at: number; v: LineNow }>();
const arrivedCache = new Map<string, { at: number; cars: any[] }>();
const forget = (tenantId: string) => { cache.delete(`${tenantId}|0`); cache.delete(`${tenantId}|1`); arrivedCache.delete(tenantId); };
/** A car just started ordering (api/counter 'car', 'aheadCar'): the line is read afresh on this server. */
export const forgetLine = forget;

/** The drive-thru's line now, for the lane screen, the voice assistant and the kitchen (kept a few seconds). `cars`: the
 *  live cars when the caller has read them already. `withOrders`: also what's being said at a speaker. */
export async function lineNow(db: any, tenantId: string, tenant: any, o: { nowMs?: number; cars?: any[]; withOrders?: boolean } = {}): Promise<LineNow> {
  const nowMs = o.nowMs ?? Date.now(); const T = `tenants/${tenantId}`;
  const ck = `${tenantId}|${o.withOrders ? 1 : 0}`; const hit = cache.get(ck);
  if (hit && nowMs - hit.at < 2500 && !o.cars) return hit.v;
  const cars: any[] = o.cars || (await db.collection(`${T}/driveThruCars`).where('stage', 'in', LIVE).limit(300).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
  const lane = cars.filter(atDriveThru);
  const inLane = inLineNow(lane, nowMs);
  const two = lanesOf(tenant) === 2;
  const [l1, l2] = await Promise.all([1, 2].map(async (l) => (l === 2 && !two ? null : ((await db.doc(`${T}/private/laneEntry_${l}`).get()).data() as EntryLog | undefined) || null)));
  const sensor = !!(l1 || l2);
  // Every car that got to order in the last 20 minutes, by when (a speaker's lane, or none: taken in line, or come for an
  // order placed ahead), whether it's still in the lane or gone: a car that's been served was still counted once at the
  // entry. (Only read with a sensor.)
  // (Read only when a car counted at the entry could still be waiting, and kept a few seconds for every screen.)
  const live = (log: EntryLog | null) => !!log && (Array.isArray(log.at) ? log.at : []).some((x) => { const t = Date.parse(String(x)); return t > nowMs - ENTRY_KEEP_MS && t > (Date.parse(String(log.clearedAt || '')) || -Infinity); });
  let recent: any[] = [];
  if (live(l1) || live(l2)) {
    const r = arrivedCache.get(tenantId);
    if (r && nowMs - r.at < 3000) recent = r.cars;
    else {
      recent = (await db.collection(`${T}/driveThruCars`).where('arrivedAt', '>=', new Date(nowMs - ENTRY_KEEP_MS).toISOString()).limit(400).get()).docs.map((d: any) => d.data() || {}).filter(atDriveThru)
        .map((c: any) => ({ arrivedAt: c.arrivedAt, lane: c.lane, inLine: c.inLine, wasInLine: c.wasInLine }));
      arrivedCache.set(tenantId, { at: nowMs, cars: recent }); if (arrivedCache.size > 500) arrivedCache.delete(arrivedCache.keys().next().value as string);
    }
  }
  const arrivals = recent.filter((c: any) => c.arrivedAt).map((c: any) => ({ at: String(c.arrivedAt), lane: two ? (c.inLine === true || c.wasInLine === true ? null : cleanLane(c.lane)) : (1 as const) }));
  const byLane = sensor ? waitingByLane({ 1: l1, 2: l2 }, arrivals, nowMs) : { 1: 0, 2: 0 };
  const waiting = byLane[1] + byLane[2];
  let ordering: EarlyOrder[] = [];
  if (o.withOrders) {
    // What's being said at a speaker (or to someone taking orders in line): the orders still being built, newest last;
    // one left at the speaker over 15 minutes is a car that drove off, not an order coming.
    const at = lane.filter((c: any) => c.stage === 'speaker' && c.orderId && nowMs - Date.parse(String(c.arrivedAt || '')) < 15 * 60000).slice(0, 12);
    const docs = at.length ? await db.getAll(...at.map((c: any) => db.doc(`${T}/counterOrders/${c.orderId}`))) : [];
    ordering = at.map((c: any, i: number) => ({ orderId: String(c.orderId), number: String(c.number || ''), lane: two ? cleanLane(c.lane) : null, since: String(c.arrivedAt || ''), lines: earlyLines(docs[i]?.data?.()) }))
      .filter((x: EarlyOrder) => x.lines.length).sort((a: EarlyOrder, b: EarlyOrder) => a.since.localeCompare(b.since));
  }
  const v: LineNow = { inLane, waiting, byLane, sensor, rush: isRush(inLane, waiting), ordering };
  if (!o.cars) { cache.set(ck, { at: nowMs, v }); if (cache.size > 500) cache.delete(cache.keys().next().value as string); }
  return v;
}
