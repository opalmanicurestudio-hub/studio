// src/lib/lane-entry-server.ts — THE LANE ENTRY SENSOR AND THE LINE NOW, on the server (lib/lane-entry works it out).
// - The sensor's link (api/counter/lane-entry): a manager makes one per lane on the Menu page; it's shown once, and only
//   its fingerprint is kept (tenants/{t}/private/laneSensors, which no browser can read). Making a new one stops the old.
// - Each car it counts: tenants/{t}/private/laneEntry_{lane}, the counts of the last 20 minutes and when the line was
//   last said to be clear.
// - The line now (lineNow): cars in the lane, those waiting to order, whether it's a rush, and the orders being taken at
//   a speaker, read once every few seconds for the business however many screens ask.
// - With more than one location (design board "Sold out here or everywhere, each location's own night, and its own lane
//   sensor"), each location's lanes have their own link and count (laneEntry_{locationId}_{lane}), and its screens show
//   its own line, rush and Line's clear. One set up before there were locations (no location) counts for screens that
//   aren't set up for one.
import { createHash, randomBytes } from 'crypto';
import { addEntry, waitingByLane, isRush, earlyLines, ENTRY_KEEP_MS, POINT_GAP_MS, pointOf, addArrival, unclaimedArrivals, windowCar, exitPick, payCar, mobileDocId, MOBILE_KEEP_MS, parkedUnknown, SPEAKER_MATCH_MS, speakerDocId, type EntryLog, type EarlyLine, type SensorPoint, type ArrivalLog } from '@/lib/lane-entry';
import { lanesOf, cleanLane, byWindow } from '@/lib/drive-lanes';
import { forgetLive } from '@/lib/drive-live-server';
import { inLineNow, atDriveThru } from '@/lib/counter-orders';
import { atHere } from '@/lib/business-locations';

const hash = (k: string) => createHash('sha256').update(String(k)).digest('hex');
const LIVE = ['speaker', 'pay', 'pickup', 'forward'];
type Sensor = { lane: 1 | 2; createdAt: string; createdBy: string; lastAt?: string | null; locationId?: string | null;
  /** Where along the lane (lib/lane-entry SENSOR_POINTS); none: the lane entry, as every link made before there were more. */
  point?: SensorPoint };
const ID = /^[A-Za-z0-9_-]{1,120}$/;
/** A lane's count (and when its sensor last counted a car), for one location or none. */
export const entryId = (lane: 1 | 2, at?: string | null) => (at ? `laneEntry_${at}_${lane}` : `laneEntry_${lane}`);
const lastKey = (lane: 1 | 2, at?: string | null, point: SensorPoint = 'entry') => `${point === 'entry' ? '' : `${point}_`}${at ? `${at}_${lane}` : String(lane)}`;
/** Cars the speaker's sensor saw pull up, not started yet (lib/lane-entry ArrivalLog), for one lane at one location. */
export const speakerId = speakerDocId;
/** When the exit's sensor last saw a car leave that it couldn't tell, at one location. */
export const exitId = (at?: string | null) => (at ? `laneExit_${at}` : 'laneExit');
/** The same link: its lane, location and place along the lane. */
const samePlace = (v: Sensor | undefined, lane: 1 | 2, at: string | null, point: SensorPoint, live: Set<string>) => !!v && v.lane === lane && liveAt(v, live) === at && pointOf(v.point) === point;
const atOf = (x: Sensor | undefined) => (x?.locationId && ID.test(String(x.locationId)) ? String(x.locationId) : null);
/** The business's locations, when it has more than one (a sensor's location counts only then, and only while it's still
 *  one of them: back to one location, or that location closed, it's the business's own again). */
async function liveIds(db: any, tenantId: string): Promise<Set<string>> {
  const { bizLocationsOf } = await import('@/lib/here-server');
  const locs = await bizLocationsOf(db, tenantId).catch(() => [] as any[]);
  return new Set(locs.length > 1 ? locs.map((l: any) => String(l.id)) : []);
}
const liveAt = (x: Sensor | undefined, live: Set<string>) => { const a = atOf(x); return a && live.has(a) ? a : null; };
export type SensorView = { lane: 1 | 2; on: boolean; lastAt: string | null; locationId: string | null; place: string | null };

/** The lanes' sensors, for the Menu page: which are set up, and when each last counted a car (never the link). With more
 *  than one location (`places`), each location's lanes, and any set up before there were locations. */
export async function sensorsView(db: any, tenantId: string, _tenant?: any, places: { id: string; name: string }[] = []): Promise<SensorView[]> {
  const s: any = (await db.doc(`tenants/${tenantId}/private/laneSensors`).get()).data() || {};
  const all = Object.values((s.tokens || {}) as Record<string, Sensor>); const live = await liveIds(db, tenantId);
  const on = (l: 1 | 2, at: string | null) => all.some((x) => x.lane === l && liveAt(x, live) === at && pointOf(x.point) === 'entry');
  const row = (l: 1 | 2, at: string | null, place: string | null): SensorView => ({ lane: l, on: on(l, at), lastAt: (s.last || {})[lastKey(l, at)] || null, locationId: at, place });
  // (Both lanes, so the page shows lane 2's at once when two lanes are turned on.)
  if (places.length < 2) return ([1, 2] as const).map((l) => row(l, null, null));
  return [...places.flatMap((p) => ([1, 2] as const).map((l) => row(l, p.id, p.name))), ...([1, 2] as const).filter((l) => on(l, null)).map((l) => row(l, null, null))];
}

export type PointView = { point: SensorPoint; lane: 1 | 2; on: boolean; lastAt: string | null; locationId: string | null; place: string | null };
/** The sensors further along the lane, for the Menu page: the speaker (each lane's), the pickup window and the exit, at
 *  each location with more than one; which are set up, and when each last saw a car (never the link). */
export async function pointsView(db: any, tenantId: string, two: boolean, places: { id: string; name: string }[] = []): Promise<PointView[]> {
  const s: any = (await db.doc(`tenants/${tenantId}/private/laneSensors`).get()).data() || {};
  const all = Object.values((s.tokens || {}) as Record<string, Sensor>); const live = await liveIds(db, tenantId);
  const row = (point: SensorPoint, l: 1 | 2, at: string | null, place: string | null): PointView => ({ point, lane: l, on: all.some((x) => samePlace(x, l, at, point, live)), lastAt: (s.last || {})[lastKey(l, at, point)] || null, locationId: at, place });
  const rows = (at: string | null, place: string | null) => [...(two ? [1, 2] as const : [1] as const).map((l) => row('speaker', l, at, place)), row('pay', 1, at, place), row('window', 1, at, place), row('exit', 1, at, place), row('mobile', 1, at, place)];
  return places.length < 2 ? rows(null, null) : places.flatMap((p) => rows(p.id, p.name));
}

/** A new link for a lane's sensor (the old one, if any, stops): its key, shown once. `at`: at that location. */
export async function newSensor(db: any, tenantId: string, lane: 1 | 2, by: string, at: string | null = null, point: SensorPoint = 'entry'): Promise<string> {
  const key = randomBytes(24).toString('hex');
  const ref = db.doc(`tenants/${tenantId}/private/laneSensors`); const live = await liveIds(db, tenantId);
  await db.runTransaction(async (tx: any) => {
    const s: any = (await tx.get(ref)).data() || {};
    const tokens: Record<string, Sensor> = Object.fromEntries(Object.entries((s.tokens || {}) as Record<string, Sensor>).filter(([, v]) => !samePlace(v, lane, at, point, live)));
    tokens[hash(key)] = { lane, createdAt: new Date().toISOString(), createdBy: String(by).slice(0, 80), ...(at ? { locationId: at } : {}), ...(point !== 'entry' ? { point } : {}) };
    // (Its count starts now, empty, so the lane screen shows the line from the first car; and the mobile pickup spots'
    // list, so the curbside screen keeps watching for a car from the first.)
    const eRef = db.doc(`tenants/${tenantId}/private/${entryId(lane, at)}`); const e = (await tx.get(eRef)).data();
    const mRef = db.doc(`tenants/${tenantId}/private/${mobileDocId(at)}`); const m = point === 'mobile' ? (await tx.get(mRef)).data() : true;
    tx.set(ref, { tokens, last: s.last || {} });
    if (!e && point === 'entry') tx.set(eRef, { at: [], clearedAt: new Date().toISOString() });
    if (!m) tx.set(mRef, { at: [] });
  });
  forget(tenantId);
  return key;
}

/** A lane's sensor turned off: its link stops counting. `at`: that location's. */
export async function stopSensor(db: any, tenantId: string, lane: 1 | 2, at: string | null = null, point: SensorPoint = 'entry'): Promise<void> {
  const ref = db.doc(`tenants/${tenantId}/private/laneSensors`); const live = await liveIds(db, tenantId);
  await db.runTransaction(async (tx: any) => {
    const s: any = (await tx.get(ref)).data() || {};
    tx.set(ref, { tokens: Object.fromEntries(Object.entries((s.tokens || {}) as Record<string, Sensor>).filter(([, v]) => !samePlace(v, lane, at, point, live))), last: s.last || {} });
    // (Its count goes with it: the lane screen stops showing a line it can't see; the same for the cars the speaker's
    // saw pull up, and a car the exit's couldn't tell.)
    if (point === 'entry') tx.delete(db.doc(`tenants/${tenantId}/private/${entryId(lane, at)}`));
    if (point === 'speaker') tx.delete(db.doc(`tenants/${tenantId}/private/${speakerId(lane, at)}`));
    if (point === 'exit') tx.delete(db.doc(`tenants/${tenantId}/private/${exitId(at)}`));
    if (point === 'mobile') tx.delete(db.doc(`tenants/${tenantId}/private/${mobileDocId(at)}`));
  });
  forget(tenantId);
}

/** A car passed the sensor whose key this is: counted in its lane (the same car seen twice in a moment, once). */
export async function sensorCar(db: any, tenantId: string, key: string, nowMs = Date.now()): Promise<{ ok: true; lane: 1 | 2; counted: boolean; point?: SensorPoint } | { ok: false }> {
  if (!/^[a-f0-9]{48}$/.test(key) || !/^[A-Za-z0-9_-]{1,160}$/.test(tenantId)) return { ok: false };
  const sRef = db.doc(`tenants/${tenantId}/private/laneSensors`);
  const s: any = (await sRef.get()).data();
  const me: Sensor | undefined = s?.tokens?.[hash(key)];
  const lane = cleanLane(me?.lane); if (!lane) return { ok: false };
  // (Counted at its own location's lane, when it's set up for one that's still one of the business's several.)
  const at = liveAt(me, await liveIds(db, tenantId));
  // The speaker, the pickup window or the exit: a car there now (pointCar).
  const point = pointOf(me?.point);
  if (point !== 'entry') {
    const counted = await pointCar(db, tenantId, point, lane, at, key, nowMs);
    if (!(nowMs - (Date.parse(String(s?.last?.[lastKey(lane, at, point)] || '')) || 0) < 30000)) await sRef.set({ last: { [lastKey(lane, at, point)]: new Date(nowMs).toISOString() } }, { merge: true }).catch(() => null);
    forget(tenantId); forgetLive(tenantId);
    return { ok: true, lane, counted, point };
  }
  const ref = db.doc(`tenants/${tenantId}/private/${entryId(lane, at)}`);
  const counted = await db.runTransaction(async (tx: any) => {
    // (Its link read again with the count: one turned off this instant never starts a count again.)
    const [still, log] = await Promise.all([tx.get(sRef), tx.get(ref)]);
    const now: Sensor | undefined = (still.data() as any)?.tokens?.[hash(key)];
    if (cleanLane(now?.lane) !== lane || atOf(now) !== atOf(me)) return false;
    const r = addEntry(log.data() as EntryLog | undefined, nowMs);
    if (r.counted) tx.set(ref, r.log);
    return r.counted;
  });
  // (When it last counted a car, for the Menu page: kept to the half minute, so a chattering sensor isn't a write a call.)
  if (!(nowMs - (Date.parse(String(s?.last?.[lastKey(lane, at)] || '')) || 0) < 30000)) await sRef.set({ last: { [lastKey(lane, at)]: new Date(nowMs).toISOString() } }, { merge: true }).catch(() => null);
  forget(tenantId);
  return { ok: true, lane, counted };
}

/** A car at the speaker, the pickup window or the exit (lib/lane-entry). Never throws past the caller's answer: a car it
 *  can't place is only counted. `key`: the link's own key, so a link turned off this instant does nothing. */
async function pointCar(db: any, tenantId: string, point: SensorPoint, lane: 1 | 2, at: string | null, key: string, nowMs: number): Promise<boolean> {
  const T = `tenants/${tenantId}`; const nowIso = new Date(nowMs).toISOString(); const sRef = db.doc(`${T}/private/laneSensors`);
  const stillOn = async (tx: any) => { const v: Sensor | undefined = ((await tx.get(sRef)).data() as any)?.tokens?.[hash(key)]; return !!v && pointOf(v.point) === point && cleanLane(v.lane) === lane; };
  const here = (c: any) => atDriveThru(c) && atHere(c, at) && inLineNow([c], nowMs) === 1;
  const read = async (q: any) => (await q.get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
  const carRef = (id: string) => db.doc(`${T}/driveThruCars/${id}`);
  // (The same car seen again while it's there is one car: lib/lane-entry POINT_GAP_MS. Checked before anything else is
  // read, so a sensor that keeps firing costs one read a call.)
  const seenRef = db.doc(`${T}/private/lanePoint_${point}${at ? `_${at}` : ''}_${lane}`);
  const fresh = await db.runTransaction(async (tx: any) => {
    const last = Number(((await tx.get(seenRef)).data() || {}).lastMs) || 0;
    if (nowMs - last < POINT_GAP_MS[point as Exclude<SensorPoint, 'entry'>] && nowMs >= last) return false;
    tx.set(seenRef, { lastMs: nowMs }); return true;
  }).catch(() => true);
  if (!fresh) return false;

  if (point === 'speaker') {
    // A car someone started at this speaker a moment ago (quicker than the sensor) is the one it saw; otherwise a car
    // pulled up that nobody has started yet: kept until someone does (lib/counter-server createCar takes it).
    const just = (await read(db.collection(`${T}/driveThruCars`).where('arrivedAt', '>=', new Date(nowMs - SPEAKER_MATCH_MS).toISOString()).limit(30)))
      .filter((c: any) => here(c) && c.stage === 'speaker' && c.inLine !== true && !c.speakerSeen && !c.greetedAt && (cleanLane(c.lane) || 1) === lane)
      .sort((a: any, b: any) => String(a.arrivedAt).localeCompare(String(b.arrivedAt)))[0];
    const ref = db.doc(`${T}/private/${speakerId(lane, at)}`);
    return db.runTransaction(async (tx: any) => {
      const [on, log, car] = await Promise.all([stillOn(tx), tx.get(ref), just ? tx.get(carRef(just.id)) : Promise.resolve(null)]);
      if (!on) return false;
      const c: any = car?.data?.();
      if (c && c.stage === 'speaker' && !c.speakerSeen && !c.greetedAt) { tx.set(carRef(just.id), { speakerSeen: nowIso }, { merge: true }); return true; }
      const r = addArrival(log.data() as ArrivalLog | undefined, nowMs);
      if (r.counted) tx.set(ref, r.log);
      return r.counted;
    });
  }

  if (point === 'mobile') {
    // A car parked in a mobile pickup spot: kept ten minutes for its guest to say they're here (lib/lane-entry
    // parkedUnknown; the curbside screen and Drive-thru live).
    const ref = db.doc(`${T}/private/${mobileDocId(at)}`);
    return db.runTransaction(async (tx: any) => {
      const [on, log] = await Promise.all([stillOn(tx), tx.get(ref)]); if (!on) return false;
      const r = addArrival(log.data() as ArrivalLog | undefined, nowMs, MOBILE_KEEP_MS);
      if (r.counted) tx.set(ref, r.log);
      return r.counted;
    });
  }

  const two = lanesOf((await db.doc(T).get()).data() || {}) === 2;
  if (point === 'pay') {
    // The first car on its way to pay that isn't at the pay window yet got there.
    const line = (await read(db.collection(`${T}/driveThruCars`).where('stage', '==', 'pay').limit(100))).filter(here).sort(byWindow(two));
    const c = payCar(line); if (!c) return false;
    return db.runTransaction(async (tx: any) => {
      const [on, snap] = await Promise.all([stillOn(tx), tx.get(carRef(c.id))]); const car: any = snap.data();
      if (!on || !car || car.stage !== 'pay' || car.stageAt?.payWindow) return false;
      tx.set(carRef(c.id), { stageAt: { ...(car.stageAt || {}), payWindow: nowIso } }, { merge: true });
      return true;
    });
  }
  if (point === 'window') {
    // The first paid car in the line to the window that isn't at the window yet got there.
    const line = (await read(db.collection(`${T}/driveThruCars`).where('stage', '==', 'pickup').limit(100))).filter(here).sort(byWindow(two));
    const c = windowCar(line); if (!c) return false;
    return db.runTransaction(async (tx: any) => {
      const [on, snap] = await Promise.all([stillOn(tx), tx.get(carRef(c.id))]); const car: any = snap.data();
      if (!on || !car || car.stage !== 'pickup' || car.stageAt?.window) return false;
      tx.set(carRef(c.id), { stageAt: { ...(car.stageAt || {}), window: nowIso } }, { merge: true });
      return true;
    });
  }

  // The exit: which car drove off (lib/lane-entry exitPick).
  const [waiting, gone] = await Promise.all([
    read(db.collection(`${T}/driveThruCars`).where('stage', 'in', ['pickup', 'forward']).limit(100)),
    read(db.collection(`${T}/driveThruCars`).where('goneAt', '>=', new Date(nowMs - 60000).toISOString()).limit(30)),
  ]);
  const mine = waiting.filter(here);
  const pick = exitPick({ atWindow: mine.filter((c: any) => c.stage === 'pickup'), parked: mine.filter((c: any) => c.stage === 'forward'), gone: gone.filter((c: any) => atDriveThru(c) && atHere(c, at)) }, nowMs);
  const askRef = db.doc(`${T}/private/${exitId(at)}`);
  if (pick.kind === 'handed') { await carRef(pick.car.id).set({ exitAt: nowIso }, { merge: true }); return true; }
  if (pick.kind === 'handover') {
    // Handed over on its own only when nothing's in doubt: paid, everything ready, no allergy the kitchen hasn't noted,
    // not a delivery app's (its courier is handed it at the counter).
    const { handOverInTx } = await import('@/lib/counter-handover');
    const { ticketFrom, needsAllergyNote } = await import('@/lib/kitchen');
    const done = await db.runTransaction(async (tx: any) => {
      const [on, snap] = await Promise.all([stillOn(tx), tx.get(carRef(pick.car.id))]); const car: any = snap.data();
      // (Handed over by the crew in the meantime: nothing to ask.)
      if (car?.stage === 'gone') return 'gone';
      if (!on || !car || car.stage !== 'pickup') return false;
      const order: any = ID.test(String(car.orderId || '')) ? (await tx.get(db.doc(`${T}/counterOrders/${car.orderId}`))).data() || null : null;
      const aheadRef = ID.test(String(car.aheadId || '')) ? db.doc(`${T}/counterOrders/${car.aheadId}`) : null;
      const ahead: any = aheadRef ? (await tx.get(aheadRef)).data() || null : null;
      const tix = order ? (await tx.get(db.collection(`${T}/kdsTickets`).where('orderId', '==', String(car.orderId)))).docs : [];
      const aheadTix = aheadRef ? (await tx.get(db.collection(`${T}/kdsTickets`).where('orderId', '==', String(car.aheadId)))).docs : [];
      const liveOf = (docs: any[]) => docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((t: any) => t.status !== 'cancelled' && t.status !== 'voided');
      // Each order: sent and paid (never one voided, canceled or done), and everything for it made: tickets that are all
      // ready, or one sent with nothing for the kitchen at all. No tickets yet is never "made".
      const settled = (o: any, live: any[]) => !!o && !['building', 'voided', 'cancelled', 'done'].includes(String(o.status)) && !!o.paidAt
        && (live.length ? live.every((t: any) => ['ready', 'delivered', 'served', 'done'].includes(String(t.status))) : o.kitchenNone === true);
      const all = [...liveOf(tix), ...liveOf(aheadTix)];
      const allergy = all.some((t: any) => t.status !== 'delivered' && needsAllergyNote(ticketFrom(t, 'kdsTickets') as any));
      if (!settled(order, liveOf(tix)) || (aheadRef && !settled(ahead, liveOf(aheadTix))) || order.app?.code || allergy) return false;
      handOverInTx(tx, db, T, { carRef: carRef(pick.car.id), car, order, tix, aheadRef, aheadTix, by: 'Exit sensor', nowIso, extra: { exitAt: nowIso } });
      return true;
    }).catch(() => false);
    if (done) return true;
  }
  // Which car it was isn't certain: the window is asked to check (Drive-thru live).
  await askRef.set({ askAt: nowIso }, { merge: true });
  return true;
}

/** Cars parked in the mobile pickup spots lately whose guest hasn't said they're here (lib/lane-entry parkedUnknown), at
 *  one location: null when there's no mobile pickup sensor there (nothing to say). Curbside guests say they're here from
 *  their café order placed ahead or the shop's curbside page; one handed their order without saying so was here too. */
export async function parkedNow(db: any, tenantId: string, tenant: any, here: string | null, nowMs = Date.now()): Promise<{ n: number; since: string | null } | null> {
  const T = `tenants/${tenantId}`;
  const log: any = (await db.doc(`${T}/private/${mobileDocId(here)}`).get()).data();
  if (!log) return null;
  const cars = unclaimedArrivals(log, nowMs, MOBILE_KEEP_MS); if (!cars.length) return { n: 0, since: null };
  // (Read by when, from just before the first of those cars parked: every location's own day alike.)
  const since = new Date(Date.parse(cars[0]) - MOBILE_KEEP_MS).toISOString();
  const none = Promise.resolve({ docs: [] as any[] }); const shopOn = tenant?.modules?.retail === true;
  const [said, handed, shopSaid, shopDone] = await Promise.all([
    db.collection(`${T}/counterOrders`).where('ahead.hereAt', '>=', since).limit(300).get(),
    db.collection(`${T}/counterOrders`).where('ahead.curb.handedAt', '>=', since).limit(300).get(),
    shopOn ? db.collection(`${T}/retailOrders`).where('curbside.arrivedAt', '>=', since).limit(300).get() : none,
    shopOn ? db.collection(`${T}/retailOrders`).where('completedAt', '>=', since).limit(300).get() : none,
  ]);
  // Each guest once: when they said they're here, else when they were handed their order.
  const told = new Map<string, string>();
  for (const d of [...said.docs, ...handed.docs]) { const o = d.data() || {}; if (o.ahead?.way !== 'curbside' || !atHere(o, here)) continue; told.set(`c${d.id}`, String(o.ahead?.hereAt || o.ahead?.curb?.handedAt || '')); }
  for (const d of [...shopSaid.docs, ...shopDone.docs]) { const o = d.data() || {}; if (o.method !== 'curbside' || !atHere(o, here)) continue; told.set(`s${d.id}`, String(o.curbside?.arrivedAt || o.completedAt || '')); }
  return parkedUnknown(log, Array.from(told.values()).filter(Boolean), nowMs);
}

/** "Line's clear" on the lane screen: nobody waiting to order, in one lane or both (`at`: that location's lanes). */
export async function lineClear(db: any, tenantId: string, lane: 1 | 2 | null, nowMs = Date.now(), at: string | null = null): Promise<void> {
  // (Only a lane with a sensor has a count to clear: one with none never starts to look as if it had one.)
  await Promise.all(([1, 2] as const).filter((l) => !lane || l === lane).map(async (l) => {
    const ref = db.doc(`tenants/${tenantId}/private/${entryId(l, at)}`);
    if ((await ref.get()).exists) await ref.set({ clearedAt: new Date(nowMs).toISOString() }, { merge: true });
  }));
  forget(tenantId);
}

export type EarlyOrder = { orderId: string; number: string; lane: 1 | 2 | null; since: string; lines: EarlyLine[]; locationId?: string };
export type LineNow = { inLane: number; waiting: number; byLane: Record<1 | 2, number>; sensor: boolean; rush: boolean; ordering: EarlyOrder[] };

const cache = new Map<string, { at: number; v: LineNow }>();
const arrivedCache = new Map<string, { at: number; cars: any[] }>();
const forget = (tenantId: string) => { for (const k of Array.from(cache.keys())) if (k.startsWith(`${tenantId}|`)) cache.delete(k); arrivedCache.delete(tenantId); };
/** A car just started ordering (api/counter 'car', 'aheadCar'): the line is read afresh on this server. */
export const forgetLine = forget;

/** The drive-thru's line now, for the lane screen, the voice assistant and the kitchen (kept a few seconds). `cars`: the
 *  live cars when the caller has read them already. `withOrders`: also what's being said at a speaker. `at` (with more
 *  than one location): that location's lanes, its cars and its sensors' counts. */
export async function lineNow(db: any, tenantId: string, tenant: any, o: { nowMs?: number; cars?: any[]; withOrders?: boolean; at?: string | null } = {}): Promise<LineNow> {
  const nowMs = o.nowMs ?? Date.now(); const T = `tenants/${tenantId}`; const at = o.at || null;
  const ck = `${tenantId}|${at || ''}|${o.withOrders ? 1 : 0}`; const hit = cache.get(ck);
  if (hit && nowMs - hit.at < 2500 && !o.cars) return hit.v;
  const here = (c: any) => atHere(c, at);
  const cars: any[] = (o.cars || (await db.collection(`${T}/driveThruCars`).where('stage', 'in', LIVE).limit(300).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }))).filter(here);
  const lane = cars.filter(atDriveThru);
  const inLane = inLineNow(lane, nowMs);
  const two = lanesOf(tenant) === 2;
  const [l1, l2] = await Promise.all(([1, 2] as const).map(async (l) => (l === 2 && !two ? null : ((await db.doc(`${T}/private/${entryId(l, at)}`).get()).data() as EntryLog | undefined) || null)));
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
        .map((c: any) => ({ arrivedAt: c.arrivedAt, lane: c.lane, inLine: c.inLine, wasInLine: c.wasInLine, ...(c.locationId ? { locationId: c.locationId } : {}) }));
      arrivedCache.set(tenantId, { at: nowMs, cars: recent }); if (arrivedCache.size > 500) arrivedCache.delete(arrivedCache.keys().next().value as string);
    }
  }
  const arrivals = recent.filter((c: any) => c.arrivedAt && here(c)).map((c: any) => ({ at: String(c.arrivedAt), lane: two ? (c.inLine === true || c.wasInLine === true ? null : cleanLane(c.lane)) : (1 as const) }));
  // (A car the speaker's sensor saw pull up has reached the speaker, though nobody has started its order yet.)
  if (live(l1) || live(l2)) {
    const pulled = await Promise.all(([1, 2] as const).filter((l) => l === 1 || two).map(async (l) => unclaimedArrivals(((await db.doc(`${T}/private/${speakerId(l, at)}`).get()).data() as ArrivalLog | undefined) || null, nowMs).map((x) => ({ at: x, lane: two ? l : (1 as const) }))));
    arrivals.push(...pulled.flat());
  }
  const byLane = sensor ? waitingByLane({ 1: l1, 2: l2 }, arrivals, nowMs) : { 1: 0, 2: 0 };
  const waiting = byLane[1] + byLane[2];
  let ordering: EarlyOrder[] = [];
  if (o.withOrders) {
    // What's being said at a speaker (or to someone taking orders in line): the orders still being built, newest last;
    // one left at the speaker over 15 minutes is a car that drove off, not an order coming.
    const at = lane.filter((c: any) => c.stage === 'speaker' && c.orderId && nowMs - Date.parse(String(c.arrivedAt || '')) < 15 * 60000).slice(0, 12);
    const docs = at.length ? await db.getAll(...at.map((c: any) => db.doc(`${T}/counterOrders/${c.orderId}`))) : [];
    ordering = at.map((c: any, i: number) => ({ orderId: String(c.orderId), number: String(c.number || ''), lane: two ? cleanLane(c.lane) : null, since: String(c.arrivedAt || ''), lines: earlyLines(docs[i]?.data?.()), ...(c.locationId ? { locationId: String(c.locationId) } : {}) }))
      .filter((x: EarlyOrder) => x.lines.length).sort((a: EarlyOrder, b: EarlyOrder) => a.since.localeCompare(b.since));
  }
  const v: LineNow = { inLane, waiting, byLane, sensor, rush: isRush(inLane, waiting), ordering };
  if (!o.cars) { cache.set(ck, { at: nowMs, v }); if (cache.size > 500) cache.delete(cache.keys().next().value as string); }
  return v;
}
