// src/lib/drive-live-server.ts — DRIVE-THRU LIVE, read on the server (lib/drive-live; api/drive-live; the Drive-thru
// live page). Every car in the drive-thru now (tenants/{t}/driveThruCars, stage speaker to forward), each with its guest's
// first name, how the kitchen is getting on with its order and what it's still making; the cars counted at the lane
// entry that haven't reached the speaker (lib/lane-entry-server); and, underneath, curbside, orders placed ahead for the
// drive-thru and the counter's line. Read at most every few seconds per business and location, however many phones and
// screens are watching.
import type { LiveCar, LiveNow, LiveStage, KitchenNow } from '@/lib/drive-live';
import { LIVE_STAGES } from '@/lib/drive-live';
import { targetsOf, spotsOf, atDriveThru, counterSide, inLineNow, cleanLooks } from '@/lib/counter-orders';
import { lanesOf, cleanLane } from '@/lib/drive-lanes';
import { atHere } from '@/lib/business-locations';
import { tenantTimeZone } from '@/lib/tenant-time';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const first = (v: unknown) => { const s = String(v ?? '').normalize('NFC').replace(/[^\p{L}\p{M}'’ .-]/gu, ' ').replace(/\s+/g, ' ').trim(); return /\p{L}/u.test(s) ? Array.from(s.split(' ')[0]).slice(0, 24).join('') : null; };
const iso = (v: unknown) => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null);
const WAITING = ['pending', 'in_progress'];
const DONE = ['ready', 'delivered', 'served', 'done'];

/** One order's kitchen: not sent (still being taken, or nothing on the kitchen's screen for it yet), being made, or
 *  ready (every ticket done, or sent with nothing for the kitchen to make). */
function kitchenOf(order: any, tix: any[]): KitchenNow {
  if (!order || order.status === 'building') return 'not sent';
  if (!tix.length) return order.kitchenNone === true ? 'ready' : 'not sent';
  return tix.every((t) => DONE.includes(String(t.status))) ? 'ready' : 'making';
}

const cache = new Map<string, { at: number; v: LiveNow }>();
/** Something moved a car: the next read is fresh. */
export const forgetLive = (tenantId: string) => { for (const m of [cache, curbCache] as Map<string, unknown>[]) for (const k of Array.from(m.keys())) if (k.startsWith(`${tenantId}|`)) m.delete(k); };

/** The drive-thru now, at one location (`here`) or the whole business. */
export async function liveNow(db: any, tenantId: string, tenant: any, here: string | null, o: { nowMs?: number; locationName?: string | null; timeZone?: string | null } = {}): Promise<LiveNow> {
  const nowMs = o.nowMs ?? Date.now(); const T = `tenants/${tenantId}`;
  const key = `${tenantId}|${here || ''}`; const hit = cache.get(key);
  if (hit && nowMs - hit.at < 2500) return hit.v;
  const all: any[] = (await db.collection(`${T}/driveThruCars`).where('stage', 'in', LIVE_STAGES).limit(300).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }))
    // (Only cars in the lane now: one left behind this morning never shows.)
    .filter((c: any) => atHere(c, here) && inLineNow([c], nowMs) === 1);
  const drive = all.filter(atDriveThru).sort((a, b) => String(a.arrivedAt || '').localeCompare(String(b.arrivedAt || ''))).slice(-40);
  const counter = all.filter((c) => counterSide(c.channel));
  // Each car's order (its guest's name, whether it's been sent) and the kitchen's tickets for it (and for an order placed
  // ahead going with it).
  const orderIds = Array.from(new Set(drive.flatMap((c) => [String(c.orderId || ''), String(c.aheadId || '')]).filter((x) => ID.test(x))));
  const [orders, tickets] = await Promise.all([
    orderIds.length ? db.getAll(...orderIds.map((id) => db.doc(`${T}/counterOrders/${id}`))) : Promise.resolve([]),
    Promise.all(Array.from({ length: Math.ceil(orderIds.length / 30) }, (_, i) => orderIds.slice(i * 30, i * 30 + 30)).map((ids) => db.collection(`${T}/kdsTickets`).where('orderId', 'in', ids).get())),
  ]);
  const orderOf = new Map<string, any>(); (orders as any[]).forEach((s: any) => { if (s?.exists !== false && s?.data?.()) orderOf.set(s.id, s.data()); });
  const ticketsOf = new Map<string, any[]>();
  for (const s of tickets as any[]) for (const d of s.docs) { const t = d.data() || {}; if (t.status === 'cancelled' || t.status === 'voided') continue; ticketsOf.set(String(t.orderId), [...(ticketsOf.get(String(t.orderId)) || []), t]); }
  const two = lanesOf(tenant) === 2;
  const cars: LiveCar[] = drive.map((c: any) => {
    const own = ID.test(String(c.orderId || '')) ? String(c.orderId) : null, ahead = ID.test(String(c.aheadId || '')) ? String(c.aheadId) : null;
    const tix = [own, ahead].flatMap((id) => (id ? ticketsOf.get(id) || [] : []));
    const ord = own ? orderOf.get(own) || null : null;
    // How the kitchen is getting on: with its own order, and with an order placed ahead going with it. Making anything
    // counts first; then anything not sent yet (a guest still adding to their order); ready only when everything is.
    // (A car always has an order of its own; one that somehow had only an order placed ahead goes by that one.)
    const states: KitchenNow[] = [...(own ? [kitchenOf(ord, ticketsOf.get(own) || [])] : ahead ? [] : ['not sent' as KitchenNow]), ...(ahead ? [kitchenOf(orderOf.get(ahead) || null, ticketsOf.get(ahead) || [])] : [])];
    const kitchen: KitchenNow = states.includes('making') ? 'making' : states.includes('not sent') ? 'not sent' : 'ready';
    const making = tix.filter((t) => WAITING.includes(String(t.status)));
    const stageAt: LiveCar['stageAt'] = {};
    for (const s of [...LIVE_STAGES, 'window'] as const) { const v = iso(c.stageAt?.[s]); if (v) stageAt[s] = v; }
    const spot = Math.floor(num(c.spot));
    return {
      id: String(c.id), number: String(c.number || '').slice(0, 12), name: first(ord?.guestName), looks: cleanLooks(c.looks), stage: (LIVE_STAGES.includes(c.stage) ? c.stage : 'speaker') as LiveStage,
      lane: two ? cleanLane(c.lane) : null, spot: spot >= 1 && spot <= 8 ? spot : null, since: String(iso(c.arrivedAt) || Object.values(stageAt).sort()[0] || new Date(nowMs).toISOString()), stageAt,
      ahead: c.ahead === true || !!c.aheadId, inLine: c.inLine === true || c.wasInLine === true, kitchen,
      waitingOn: making.slice(0, 4).map((t) => `${num(t.quantity) > 1 ? `${num(t.quantity)} ` : ''}${String(t.menuItemName || 'an item').slice(0, 40)}`),
      mergeAt: iso(c.mergeAt), hereAt: iso(c.hereAt), greetedAt: iso(c.greetedAt),
    };
  });
  // The line before the speaker (only with a lane entry sensor), and what's underneath: read side by side.
  const { lineNow, speakerId, exitId } = await import('@/lib/lane-entry-server');
  const { unclaimedArrivals } = await import('@/lib/lane-entry');
  const [line, ahead, curb, pulled, exitDoc] = await Promise.all([
    lineNow(db, tenantId, tenant, { cars: all, nowMs, at: here }).catch(() => null),
    (async () => { if (tenant?.orderAhead?.on !== true) return null; const { aheadForLane } = await import('@/lib/counter-ahead'); return (await aheadForLane(db, tenantId, tenant, nowMs)).filter((x: any) => atHere(x, here)); })().catch(() => null),
    curbsideNow(db, tenantId, tenant, here, nowMs).catch(() => null),
    // Cars the speaker's sensor saw pull up that nobody has started yet, and a car the exit's couldn't tell.
    Promise.all(([1, 2] as const).filter((l) => l === 1 || two).map(async (l) => unclaimedArrivals(((await db.doc(`${T}/private/${speakerId(l, here)}`).get()).data() as any) || null, nowMs).map((since) => ({ lane: l, since })))).catch(() => []),
    db.doc(`${T}/private/${exitId(here)}`).get().then((d: any) => d.data() || null).catch(() => null),
  ]);
  const askAt = iso(exitDoc?.askAt); const exitAsk = askAt && nowMs - Date.parse(askAt) < 2 * 60000 ? askAt : null;
  const aheadRows = (ahead || []) as any[];
  const nextAt = aheadRows.map((x) => iso(x.at)).filter((x): x is string => !!x && Date.parse(x) >= nowMs - 3600000).sort()[0] || null;
  const counterSince = counter.map((c) => iso(c.arrivedAt)).filter((x): x is string => !!x).sort()[0] || null;
  const v: LiveNow = {
    now: new Date(nowMs).toISOString(), target: targetsOf(tenant)['drive-thru'], lanes: two ? 2 : 1, spots: spotsOf(tenant), cars,
    waiting: { 1: line?.byLane?.[1] || 0, 2: two ? line?.byLane?.[2] || 0 : 0 }, sensor: !!line?.sensor, rush: !!line?.rush,
    side: {
      curbside: curb,
      ahead: ahead ? { open: aheadRows.length, here: aheadRows.filter((x) => x.hereAt).length, nextAt } : null,
      counter: counter.length ? { waiting: counter.length, longestSince: counterSince } : null,
    },
    location: here ? { id: here, name: o.locationName ?? null } : null, timeZone: o.timeZone || tenantTimeZone(tenant),
    atSpeaker: (pulled as { lane: 1 | 2; since: string }[][]).flat(), exitAsk,
  };
  cache.set(key, { at: nowMs, v }); if (cache.size > 500) cache.delete(cache.keys().next().value as string);
  return v;
}

/** Curbside now: café orders placed ahead for curbside (lib/curbside-server) and the shop's curbside orders, while
 *  curbside is offered: guests outside (and the longest wait), and those on their way. */
const curbCache = new Map<string, { at: number; v: LiveNow['side']['curbside'] }>();
async function curbsideNow(db: any, tenantId: string, tenant: any, here: string | null, nowMs: number): Promise<LiveNow['side']['curbside']> {
  const { curbsideOn } = await import('@/lib/modules');
  if (!curbsideOn(tenant)) return null;
  // (Read at most every 15 seconds per business and location: it's underneath the lane, not the lane.)
  const key = `${tenantId}|${here || ''}`; const hit = curbCache.get(key);
  if (hit && nowMs - hit.at < 15000) return hit.v;
  const v = await readCurbside(db, tenantId, tenant, here, nowMs);
  curbCache.set(key, { at: nowMs, v }); if (curbCache.size > 500) curbCache.delete(curbCache.keys().next().value as string);
  return v;
}
async function readCurbside(db: any, tenantId: string, tenant: any, here: string | null, nowMs: number): Promise<LiveNow['side']['curbside']> {
  const [{ cafeCurbside }, { zonedHere }, { isHere, onTheWay }, { ACTIVE_STAGES }] = await Promise.all([import('@/lib/curbside-server'), import('@/lib/here-server'), import('@/lib/pickups-view'), import('@/lib/orders-view')]);
  const cafe = tenant?.orderAhead?.on === true && tenant?.orderAhead?.curbside === true ? (await cafeCurbside(db, tenantId, await zonedHere(db, tenantId, tenant, here), nowMs)).filter((c: any) => atHere(c, here)) : [];
  const shop = tenant?.modules?.retail === true ? (await db.collection(`tenants/${tenantId}/retailOrders`).where('stage', 'in', ACTIVE_STAGES).limit(200).get()).docs.map((d: any) => d.data() || {})
    .filter((x: any) => String(x.method || '') === 'curbside' && atHere(x, here)) : [];
  const outside = [...cafe.filter((c: any) => c.hereAt).map((c: any) => iso(c.hereAt)), ...shop.filter(isHere).map((x: any) => iso(x.curbside?.arrivedAt))].filter((x): x is string => !!x).sort();
  const hereCount = cafe.filter((c: any) => c.hereAt).length + shop.filter(isHere).length;
  const coming = cafe.filter((c: any) => !c.hereAt && c.onWayAt).length + shop.filter(onTheWay).length;
  return { here: hereCount, longestSince: outside[0] || null, coming };
}
