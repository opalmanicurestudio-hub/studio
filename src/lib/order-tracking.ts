// src/lib/order-tracking.ts — WHAT THE CUSTOMER'S ORDER PAGE SHOWS, KEPT UP TO DATE AS IT HAPPENS (server). One small
// document per order (orderTracking/{key}), written by the server from the order and its history whenever a step
// happens: the stage, the steps so far with when each happened (only real steps of the order: lib/order-events), how
// many items are collected out of how many, and who's bringing it out (first name and photo, only until it's handed
// over). The order page listens to it, so it changes the moment something happens instead of asking every few seconds.
//
// What it holds is safe to read with nothing but its key: no name, contact, address or money beyond what the steps say,
// and items by their line only (the page has their names). The key is signed from the order with the server's own
// secret (there's no live view without one), and the document is removed once the order's link expires: when the
// server next looks at the order, and by the nightly sweep (expiresAt).
import { createHash, createHmac } from 'crypto';
import { customerSees, eventTypeOf, EVENT_INFO, OLD_NAMES } from './order-events';
import { linkExpiresAt, linkOpen } from './order-pass';
import type { OrderEventType } from './retail-orders';

const secret = () => String(process.env.ORDER_TRACK_SECRET || process.env.RETAIL_QR_SECRET || process.env.CRON_SECRET || '');

/** The tracking document's key for an order: signed, so it can't be worked out from the order number or id. '' when
 *  the server has no secret to sign with (then there's no live view, and the order page asks for the order instead). */
export function trackingKey(tenantId: string, orderId: string): string {
  const s = secret(); if (!s) return '';
  return `t${createHmac('sha256', s).update(`track:${tenantId}:${orderId}`).digest('base64url').slice(0, 32)}`;
}

export type TrackStep = { type: string; at: string; text: string };
export type TrackLine = { lineId: string; collected: number; ordered: number; missing: number; status: string };
export type Tracking = {
  v: 1; tenantId: string; stage: string; method: string;
  steps: TrackStep[];
  items: { collected: number; total: number; lines: TrackLine[] };
  bringingOut: { name: string; photo: string | null; at: string } | null;
  /** A fingerprint of everything above, so the view is written only when something in it changed. */
  sig: string;
  updatedAt: string;
  /** When it's removed by the nightly sweep: when the order's link expires (or a while after the last step). */
  expiresAt: string;
};

const firstName = (s: any) => String(s || '').trim().split(/\s+/)[0] || '';
const money = (c: any) => `$${(Math.max(0, Number(c) || 0) / 100).toFixed(2)}`;
const DAY = 864e5;

/** The kinds of step the customer sees, as read from the order's history (each scan is a count, not a step). */
export const STEP_TYPES = (Object.keys(EVENT_INFO) as OrderEventType[]).filter((t) => EVENT_INFO[t].customer && t !== 'item_scanned');

/** A step in the customer's words: what happened to their order, never who on the team did what. */
function stepText(e: any, o: any): string {
  const m = e?.meta || {}; const ship = o?.method === 'ship';
  const shorted = (o?.lines || []).some((l: any) => (Number(l?.qtyShorted) || 0) > 0);
  switch (eventTypeOf(e?.type)) {
    case 'placed': return 'Order placed';
    case 'payment_confirmed': return 'Paid';
    case 'batch_claimed': return 'We started getting it ready';
    case 'pick_complete': return shorted ? 'Everything we have is collected' : 'Everything is collected';
    case 'line_shorted': return 'An item is out of stock';
    case 'line_reopened': return 'The missing item was found after all';
    case 'packed': return 'Packed';
    case 'marked_ready': return o?.method === 'curbside' ? 'Ready for curbside pickup' : o?.method === 'delivery' ? 'Packed and ready to go out' : 'Ready for pickup';
    case 'out_for_delivery': return Number(m.attempt) > 1 ? 'Out for delivery again' : 'Out for delivery';
    case 'delivered': return 'Delivered';
    case 'delivery_failed': return 'We couldn’t deliver it this time';
    case 'customer_arrived': return 'You checked in';
    case 'handoff_scanned': return 'Pickup code checked';
    case 'shipped': return `Shipped${m.carrier ? ` with ${m.carrier}` : ''}`;
    // Who collected it isn't named here (the live view holds no names): the order page shows it with the customer's pass.
    case 'completed': return ship ? 'Delivered' : o?.method === 'delivery' ? '' : o?.handoff?.collectedBy === 'someone_else' ? 'Picked up by the person you named' : 'Picked up';
    case 'cancelled': return 'Canceled';
    case 'refund_issued': return `Refund of ${money(m.amountCents)} sent`;
    case 'return_opened': return 'Return started';
    case 'return_resolved': return 'Return settled';
    case 'replacement_created': return 'Replacement on its way';
    case 'backorder_split': return 'Part of it will come later, when it’s back in stock';
    case 'address_updated': return 'Delivery address changed';
    default: return '';
  }
}

/** The same object written the same way, whatever order its fields come back in (Firestore returns them sorted). */
function canonical(x: any): any {
  if (Array.isArray(x)) return x.map(canonical);
  if (x && typeof x === 'object') return Object.keys(x).sort().reduce((o: any, k) => { o[k] = canonical(x[k]); return o; }, {});
  return x;
}
export const trackingSig = (t: Omit<Tracking, 'sig' | 'updatedAt' | 'expiresAt'> | any): string => {
  const { sig: _s, updatedAt: _u, expiresAt: _e, ...rest } = t || {};
  return createHash('sha256').update(JSON.stringify(canonical(rest))).digest('base64url').slice(0, 22);
};

/** The tracking document from the order and its history (pure). Scans become the item counts, not steps; downloads
 *  aren't collected, so they aren't counted. */
export function buildTracking(tenantId: string, o: any, events: any[], now = new Date().toISOString(), rs: any = {}): Tracking {
  const seen = new Set<string>(); const steps: TrackStep[] = [];
  const sorted = [...(events || [])].filter((e) => e && e.at).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  for (const e of sorted) {
    const t = eventTypeOf(e.type); if (!t || !customerSees(e) || t === 'item_scanned') continue;
    // One row for each kind of step (the first time it happened), except money, changes and missing items, which each count.
    const many = t === 'refund_issued' || t === 'address_updated' || t === 'line_shorted' || t === 'line_reopened';
    const k = many ? `${t}:${e.id || e.at}` : t; if (seen.has(k)) continue; seen.add(k);
    const text = stepText(e, o); if (text) steps.push({ type: t, at: String(e.at), text });
  }
  const lines: TrackLine[] = (Array.isArray(o?.lines) ? o.lines : []).filter((l: any) => l && l.digital !== true).map((l: any) => {
    const ordered = Math.max(0, Number(l.qtyOrdered) || 0); const missing = Math.min(ordered, Math.max(0, Number(l.qtyShorted) || 0));
    return { lineId: String(l.lineId || ''), ordered, missing, collected: Math.min(ordered - missing, Math.max(0, Number(l.qtyScanned) || 0)), status: String(l.status || 'pending') };
  });
  const c = o?.curbside || {}; const stage = String(o?.stage || '');
  const base = {
    v: 1 as const, tenantId, stage, method: String(o?.method || ''),
    steps: steps.slice(-30),
    items: { collected: lines.reduce((a, l) => a + l.collected, 0), total: lines.reduce((a, l) => a + l.ordered - l.missing, 0), lines },
    // Who's bringing it out, only while it's on its way out to them (gone once it's handed over).
    bringingOut: c.bringingOutAt && ['ready', 'arrived'].includes(stage) ? { name: firstName(c.bringingOutBy) || 'Someone from the team', photo: c.bringingOutPhoto || null, at: String(c.bringingOutAt) } : null,
  };
  const until = linkExpiresAt(o, rs);
  return { ...base, sig: trackingSig(base), updatedAt: now, expiresAt: until || new Date(Date.parse(now) + 60 * DAY).toISOString() };
}

/** The order's customer-visible history, read without its scans (each scan is a count on the order's lines). */
export async function stepEvents(db: any, tenantId: string, orderId: string): Promise<any[]> {
  const col = db.collection(`tenants/${tenantId}/retailOrders/${orderId}/events`);
  const out: any[] = [];
  for (let i = 0; i < STEP_TYPES.length; i += 30) {
    const s = await col.where('type', 'in', STEP_TYPES.slice(i, i + 30)).limit(200).get();
    s.docs.forEach((d: any) => out.push({ id: d.id, ...(d.data() || {}) }));
  }
  // Older names (lib/order-events) for steps written before they had one name.
  const old = await col.where('type', 'in', Object.keys(OLD_NAMES).slice(0, 30)).limit(40).get().catch(() => ({ docs: [] }));
  old.docs.forEach((d: any) => out.push({ id: d.id, ...(d.data() || {}) }));
  return out;
}

/** Writes the view when something in it changed (or removes it once the order's link has expired). Returns it. */
export async function putTracking(db: any, tenantId: string, orderId: string, o: any, rs: any, events?: any[]): Promise<Tracking | null> {
  const key = trackingKey(tenantId, orderId); if (!key) return null;
  const ref = db.doc(`orderTracking/${key}`);
  if (!o || !linkOpen(o, rs)) { await ref.delete().catch(() => {}); return null; }
  const built = buildTracking(tenantId, { ...o, id: orderId }, events || await stepEvents(db, tenantId, orderId), new Date().toISOString(), rs);
  const cur = (await ref.get()).data();
  // Written when something in it changed, or when its time is nearly up (an order still going keeps its view).
  const soon = !cur?.expiresAt || (String(cur.expiresAt) < new Date(Date.now() + 7 * DAY).toISOString() && built.expiresAt > String(cur.expiresAt));
  if (!cur || cur.sig !== built.sig || soon) await ref.set(built);
  return built;
}

/** Brings an order's tracking document up to date. Best effort: the order page also asks for the order now and then,
 *  so a missed write is seen within a minute. */
export async function syncTracking(db: any, tenantId: string, orderId: string): Promise<void> {
  try {
    if (!trackingKey(tenantId, orderId)) return;
    const [os, ts] = await Promise.all([db.doc(`tenants/${tenantId}/retailOrders/${orderId}`).get(), db.doc(`tenants/${tenantId}`).get()]);
    await putTracking(db, tenantId, orderId, os.exists ? { ...(os.data() || {}), id: orderId } : null, (ts.data?.() || {}).retailSettings || {});
  } catch (e: any) {
    console.warn('[order-tracking]', tenantId, orderId, String(e?.message || e).slice(0, 160));
  }
}

/** The nightly sweep: live views past their time go (an order whose link has expired, or long finished). */
export async function sweepTracking(db: any, now = new Date().toISOString()): Promise<number> {
  let n = 0;
  for (let round = 0; round < 10; round++) {
    const s = await db.collection('orderTracking').where('expiresAt', '<', now).limit(400).get();
    if (s.empty) break;
    const b = db.batch(); s.docs.forEach((d: any) => b.delete(d.ref)); await b.commit(); n += s.size;
    if (s.size < 400) break;
  }
  return n;
}
