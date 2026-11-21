// src/lib/curbside-server.ts — CAFÉ ORDERS FOR CURBSIDE, for the runner (design canvas: Curbside; the screen is
// components/orders/CurbsideScreen, through api/curbside). The shop's curbside orders the screen reads itself (the team
// can read them; lib/pickups-view); café orders placed ahead are server-only, so they come from here:
//   cafeCurbside — today's (and last night's) paid orders placed ahead for curbside that aren't handed over yet: where
//                  they said they are, whether they're here, how the kitchen's getting on, and who's taking it out.
//   cafeOut      — someone is taking it out: only once it's ready and they're here; their page says so, with a first name.
//   cafeHanded   — handed over: the order's done, and anything the kitchen hadn't marked served is now (as at the
//                  drive-thru window). Nothing about money changes: it was paid when it was placed.
import { openDays } from '@/lib/counter-ahead';
import { tenantTimeZone } from '@/lib/tenant-time';

const nowIso = () => new Date().toISOString();
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const first = (v: unknown) => String(v ?? '').trim().split(/\s+/)[0] || '';
const LIVE = (t: any) => t.status !== 'cancelled' && t.status !== 'voided';
const READY = ['ready', 'delivered', 'served', 'done'];
type Fail = { ok: false; error: string; status: number };
const fail = (error: string, status: number): Fail => ({ ok: false, error, status });

export type CafeCurb = { kind: 'cafe'; id: string; locationId?: string | null; number: string; name: string | null; where: string | null; note: string | null; hereAt: string | null; outAt: string | null; outBy: string | null;
  at: string | null; state: 'later' | 'making' | 'ready'; items: number; summary: string;
  /** On their way (when they set off, about how many minutes out), and checked in by their phone's location. */
  onWayAt?: string | null; eta?: number | null; found?: boolean };

/** How the kitchen is getting on with one order's tickets: waiting until later, being made, or ready (nothing to make
 *  counts as ready). */
export function kitchenState(tickets: any[], now = Date.now()): 'later' | 'making' | 'ready' {
  const live = tickets.filter(LIVE);
  if (!live.length || live.every((t) => READY.includes(String(t.status)))) return 'ready';
  return live.some((t) => t.status === 'pending' && t.holdUntil && Date.parse(t.holdUntil) > now) ? 'later' : 'making';
}

/** Read at most every few seconds per business, however many screens poll; a step taken here is seen at once. */
const cache = new Map<string, { at: number; rows: CafeCurb[] }>();
const changed = (tenantId: string) => { for (const k of [...cache.keys()]) if (k === tenantId || k.startsWith(`${tenantId}|`)) cache.delete(k); };

export async function cafeCurbside(db: any, tenantId: string, tenant: any, now = Date.now()): Promise<CafeCurb[]> {
  // (Kept for each clock: a location in another time zone has its own today.)
  const key = `${tenantId}|${tenantTimeZone(tenant)}`;
  const c = cache.get(key); if (c && now - c.at < 3000) return c.rows;
  const rows = await readCafe(db, tenantId, tenant, now);
  cache.set(key, { at: now, rows }); if (cache.size > 500) cache.delete(cache.keys().next().value as string);
  return rows;
}

async function readCafe(db: any, tenantId: string, tenant: any, now: number): Promise<CafeCurb[]> {
  const T = `tenants/${tenantId}`;
  const snaps = await Promise.all(openDays(tenant, now).map((day) => db.collection(`${T}/counterOrders`).where('day', '==', day).where('channel', '==', 'ahead').get()));
  const orders = snaps.flatMap((s: any) => s.docs).map((d: any) => ({ id: d.id, ...(d.data() || {}) }))
    // (An order for another day waiting for the kitchen isn't here yet: lib/ahead-days.)
    .filter((o: any) => o.ahead?.way === 'curbside' && o.paidAt && o.ahead?.state !== 'canceled' && !['done', 'voided', 'cancelled', 'scheduled'].includes(String(o.status)));
  const tix = new Map<string, any[]>();
  for (let i = 0; i < orders.length; i += 30) {
    const ids = orders.slice(i, i + 30).map((o: any) => o.id);
    const s = await db.collection(`${T}/kdsTickets`).where('orderId', 'in', ids).get();
    for (const d of s.docs) { const t = d.data() || {}; tix.set(t.orderId, [...(tix.get(t.orderId) || []), t]); }
  }
  return orders.map((o: any) => ({ locationId: o.locationId ? String(o.locationId) : null,
    kind: 'cafe' as const, id: o.id, number: String(o.number || ''), name: o.guestName || null, where: o.ahead?.curb?.where || null, note: o.ahead?.curb?.note || null,
    hereAt: o.ahead?.hereAt || null, outAt: o.ahead?.curb?.outAt || null, outBy: o.ahead?.curb?.outBy || null, at: o.ahead?.at || null,
    onWayAt: o.ahead?.curb?.onWayAt || null, eta: o.ahead?.curb?.etaMinutes ?? null, found: o.ahead?.curb?.source === 'geo',
    state: kitchenState(tix.get(o.id) || [], now), items: (o.lines || []).reduce((n: number, l: any) => n + num(l.quantity), 0),
    summary: (o.lines || []).slice(0, 3).map((l: any) => `${num(l.quantity) > 1 ? `${num(l.quantity)} ` : ''}${String(l.name || '').toLowerCase()}`).join(', '),
  }));
}

async function curbOrder(tx: any, db: any, T: string, orderId: string) {
  const ref = db.doc(`${T}/counterOrders/${orderId}`); const or: any = (await tx.get(ref)).data();
  if (!or || or.channel !== 'ahead' || or.ahead?.way !== 'curbside') return { ref, or: null, err: fail('This curbside order isn’t here.', 404) };
  if (!or.paidAt || or.ahead?.state === 'canceled' || ['voided', 'cancelled'].includes(String(or.status))) return { ref, or: null, err: fail('This order was cancelled.', 409) };
  // (For another day, still waiting to go to the kitchen: nothing's made yet. lib/ahead-days)
  if (or.status === 'scheduled') return { ref, or: null, err: fail('This order is for another day. It goes to the kitchen on its day.', 409) };
  return { ref, or, err: null };
}

export async function cafeOut(db: any, tenantId: string, orderId: string, who: { name: string }): Promise<{ ok: true; already?: boolean } | Fail> {
  const T = `tenants/${tenantId}`;
  try { return await db.runTransaction(async (tx: any) => {
    const { ref, or, err } = await curbOrder(tx, db, T, orderId); if (err) return err;
    const tickets = (await tx.get(db.collection(`${T}/kdsTickets`).where('orderId', '==', orderId))).docs.map((d: any) => d.data() || {});
    if (or.status === 'done') return fail('It’s already handed over.', 409);
    if (or.ahead?.curb?.outAt) return { ok: true, already: true };
    if (!or.ahead?.hereAt) return fail('They haven’t said they’re here yet.', 409);
    if (kitchenState(tickets) !== 'ready') return fail('It isn’t ready yet.', 409);
    tx.set(ref, { ahead: { curb: { outAt: nowIso(), outBy: first(who.name) || null } } }, { merge: true });
    return { ok: true };
  }); } finally { changed(tenantId); }   // once it's saved: the next read sees it
}

export async function cafeHanded(db: any, tenantId: string, orderId: string, who: { name: string }): Promise<{ ok: true; already?: boolean } | Fail> {
  const T = `tenants/${tenantId}`;
  try { return await db.runTransaction(async (tx: any) => {
    const { ref, or, err } = await curbOrder(tx, db, T, orderId); if (err) return err;
    const docs = (await tx.get(db.collection(`${T}/kdsTickets`).where('orderId', '==', orderId))).docs;
    if (or.status === 'done') return { ok: true, already: true };
    if (kitchenState(docs.map((d: any) => d.data() || {})) !== 'ready') return fail('It isn’t ready yet.', 409);
    const at = nowIso();
    tx.set(ref, { status: 'done', doneAt: at, ahead: { curb: { handedAt: at, handedBy: first(who.name) || null } } }, { merge: true });
    for (const d of docs) { const t: any = d.data() || {}; if (LIVE(t) && t.status !== 'delivered') tx.set(d.ref, { status: 'delivered', deliveredAt: at, deliveredBy: { name: who.name, via: 'curbside' } }, { merge: true }); }
    return { ok: true };
  }); } finally { changed(tenantId); }
}
