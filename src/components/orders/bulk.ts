'use client';
// src/components/orders/bulk.ts — WORK ON SEVERAL ORDERS AT ONCE. Print a pick list or packing slips for the chosen
// orders, buy labels for the packed ship orders among them, mark labelled ones as shipped, and hold or release
// orders for review. Each action reports what it did and what it skipped, in plain words.
import { addDoc, collection, doc, updateDoc, type Firestore } from 'firebase/firestore';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { openPrint } from '@/lib/open-print';
import { shipIt } from '@/lib/orders-flow';
import type { Actor } from '@/lib/retail-fulfill';
import type { DaySummary, LabelPlan, LeftOut } from '@/lib/ship-run';

export const needsLabel = (o: any) => o.method === 'ship' && o.stage === 'packed' && !o.trackingNumber && !o.labelUrl;
export const canMarkShipped = (o: any) => o.method === 'ship' && o.stage === 'packed' && !!o.trackingNumber;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function printFor(t: string, orders: any[], show: 'picks' | 'slips'): Promise<string | null> {
  if (!orders.length) return 'Pick at least one order.';
  return openPrint(t, 'orders', `/print/orders/${t}?show=${show}&ids=${orders.map((o) => o.id).join(',')}`);
}

export async function printLabels(t: string, orders: any[]): Promise<string | null> {
  const ids = orders.filter((o) => o.labelUrl).map((o) => o.id).slice(0, 100);
  if (!ids.length) return 'None of these have a label yet.';
  return openPrint(t, 'orders', `/print/labels/${t}?ids=${ids.join(',')}`);
}

/** Every packed ship order's label priced, nothing bought (Ship today's step 1): what each would cost and why any
 *  can't have one yet. Asked 10 at a time, so a big day is priced in full and each request stays quick; a batch that
 *  couldn't be priced lists its orders as left out, with why. `signal` stops it (the orders changed, or a buy began). */
export async function previewLabels(t: string, orders: any[], signal?: AbortSignal): Promise<{ ok: boolean; plans: LabelPlan[]; left: LeftOut[]; error?: string }> {
  const all = orders.filter(needsLabel);
  const plans: LabelPlan[] = []; const left: LeftOut[] = []; let error = '';
  for (let i = 0; i < all.length; i += 10) {
    if (signal?.aborted) break;
    const todo = all.slice(i, i + 10);
    try {
      const r = await fetch('/api/retail/shipping-labels-bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, signal,
        body: JSON.stringify({ tenantId: t, preview: true, orders: todo.map((o) => ({ orderId: o.id, qrToken: o.qrToken || '' })) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { error = d.error || 'The labels couldn’t be priced.'; left.push(...todo.map((o) => ({ orderId: o.id, why: `Couldn’t be priced: ${error.replace(/\.$/, '')}` }))); continue; }
      plans.push(...(d.plans || [])); left.push(...(d.left || []));
    } catch {
      if (signal?.aborted) break;
      error = 'Check your connection.'; left.push(...todo.map((o) => ({ orderId: o.id, why: 'Couldn’t be priced: check your connection' })));
    }
  }
  return { ok: !error || plans.length > 0, plans, left, ...(error ? { error } : {}) };
}

/**
 * Labels for every packed ship order that needs one (api/retail/shipping-labels-bulk). Sent six at a time, so each
 * request finishes well inside the server's time limit; any the server didn't get to come back and go again. A label
 * is one box's: an order in two boxes is two labels.
 */
export async function buyLabels(t: string, orders: any[], rs: any): Promise<{ ok: boolean; message: string; boughtIds: string[]; spentCents: number; boxes: number; failed: { orderId: string; error: string }[] }> {
  const all = orders.filter(needsLabel);
  if (!all.length) return { ok: false, message: 'None of these are packed ship orders waiting for a label.', boughtIds: [], spentCents: 0, boxes: 0, failed: [] };
  const p = (rs?.packagingPresets || [])[0];
  const bought: string[] = []; const failed: { orderId: string; error: string }[] = []; let spent = 0; let boxes = 0;
  const notes: string[] = [];   // what the check of an earlier, cut-off purchase found
  let queue = [...all]; let stalls = 0;
  for (let round = 0; queue.length && round < 60; round++) {
    const todo = queue.slice(0, 6); queue = queue.slice(6);
    try {
      const r = await fetch('/api/retail/shipping-labels-bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) },
        body: JSON.stringify({ tenantId: t, orders: todo.map((o) => ({ orderId: o.id, qrToken: o.qrToken || '' })), parcelDefaults: p ? { lengthIn: p.lengthIn, widthIn: p.widthIn, heightIn: p.heightIn, boxWeightOz: p.weightOz } : undefined }),
      });
      const d = await r.json().catch(() => null);
      // No answer the screen can read (the request was cut off): some of these may have their labels already, so they're
      // left for the Orders screen to show, not counted as failed or bought again here.
      if (!d) { failed.push(...todo.map((o) => ({ orderId: o.id, error: 'The server didn’t finish. Open Ship today again to see which got labels.' }))); continue; }
      if (!r.ok) { failed.push(...todo.map((o) => ({ orderId: o.id, error: d.error || 'The labels didn’t go through.' }))); continue; }
      const res: any[] = d.results || [];
      const got = res.filter((x) => x.ok && !x.skipped && x.labelUrl);
      bought.push(...got.map((x) => x.orderId));
      spent += got.reduce((a, x) => a + (Number(x.costCents) || 0), 0);
      boxes += got.reduce((a, x) => a + (Number(x.boxes) || 1), 0);
      failed.push(...res.filter((x) => !x.ok).map((x) => ({ orderId: String(x.orderId), error: String(x.error || 'It didn’t go through') })));
      notes.push(...res.filter((x) => x.note).map((x) => String(x.note)));
      // The ones the server ran out of time for go again first; twice with none done, and they're left for another try.
      const again = (d.notTried || []).map((id: string) => todo.find((o) => o.id === id)).filter(Boolean) as any[];
      stalls = again.length && again.length === todo.length ? stalls + 1 : 0;
      if (stalls >= 2) { failed.push(...again.map((o) => ({ orderId: o.id, error: 'Ran out of time. Buy the rest again.' }))); stalls = 0; continue; }
      queue = [...again, ...queue];
    } catch { failed.push(...todo.map((o) => ({ orderId: o.id, error: 'Check your connection.' }))); }
  }
  const what = boxes > bought.length ? `${plural(boxes, 'label')} bought for ${plural(bought.length, 'order')}` : `${plural(boxes, 'label')} bought`;
  const msg = `${what}${failed.length ? `. ${plural(failed.length, 'order')} couldn’t get one: ${failed[0].error}` : '.'}${notes.length ? ` ${notes[0]}` : ''}`;
  return { ok: bought.length > 0, message: msg, boughtIds: bought, spentCents: spent, boxes, failed };
}

export async function markAllShipped(fs: Firestore, t: string, orders: any[], actor: Actor): Promise<string> {
  const todo = orders.filter(canMarkShipped);
  if (!todo.length) return 'None of these have a label yet.';
  let ok = 0; let last = '';
  for (const o of todo) { const r = await shipIt(fs, t, o, actor, { carrier: o.carrier, number: o.trackingNumber, url: o.trackingUrl }); if (r.ok) ok++; else last = r.message; }
  return ok === todo.length ? `${plural(ok, 'order')} marked shipped.` : `${ok} of ${todo.length} marked shipped. ${last}`;
}

export async function setHold(fs: Firestore, t: string, orders: any[], actor: Actor, hold: boolean, reason = ''): Promise<string> {
  const todo = orders.filter((o) => !!o.holdForReview !== hold && !['shipped', 'handed_off', 'completed', 'cancelled'].includes(o.stage));
  if (!todo.length) return hold ? 'These are already held.' : 'None of these are held.';
  const at = new Date().toISOString();
  await Promise.all(todo.map(async (o) => {
    const ref = doc(fs, `tenants/${t}/retailOrders`, o.id);
    await updateDoc(ref, hold ? { holdForReview: true, holdReason: reason || `Held by ${actor.name}`, heldAt: at, heldBy: actor.name } : { holdForReview: false, holdReleasedAt: at, holdReleasedBy: actor.name });
    try { await addDoc(collection(ref, 'events'), { type: hold ? 'held_for_review' : 'hold_released', at, actorId: actor.id, actorName: actor.name, meta: hold ? { reason: reason || '' } : {} }); } catch { /* the flag is what matters */ }
  }));
  return hold ? `${plural(todo.length, 'order')} held. They won’t be packed until someone releases them.` : `${plural(todo.length, 'order')} released to pack.`;
}

export type Closed = { ok: boolean; message: string; documents: string[]; waitingIds: string[]; count: number; summary: DaySummary | null };

export async function closeDay(t: string): Promise<Closed> {
  try {
    const r = await fetch('/api/retail/close-day', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId: t, action: 'manifest' }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, message: d.error || 'Couldn’t close the day. Try again.', documents: [], waitingIds: [], count: 0, summary: null };
    const docs: string[] = (d.manifests || []).flatMap((m: any) => m.documents || []);
    // Forms Shippo is still making: Ship today keeps asking until their sheets turn up (formsReady).
    const waitingIds: string[] = (d.manifests || []).filter((m: any) => !(m.documents || []).length).map((m: any) => String(m.id));
    return { ok: !!d.ok, message: String(d.message || '').trim(), documents: docs, waitingIds, count: Number(d.count) || 0, summary: d.summary || null };
  } catch { return { ok: false, message: 'Couldn’t close the day. Check your connection.', documents: [], waitingIds: [], count: 0, summary: null }; }
}

/** The day so far (boxes, postage, insurance, carriers, money coming back), without closing it. */
export async function daySoFar(t: string): Promise<DaySummary | null> {
  try {
    const r = await fetch('/api/retail/close-day', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId: t, action: 'summary' }) });
    const d = await r.json().catch(() => ({}));
    return r.ok ? d.summary || null : null;
  } catch { return null; }
}

/** A USPS pickup as the server keeps it (api/retail/pickup): CONFIRMED with its confirmation number, PENDING when USPS
 *  hasn't confirmed it yet, UNKNOWN when Shippo didn't answer (it may be booked: check with USPS first). */
export type PickupBooking = { day: string; status: 'CONFIRMED' | 'PENDING' | 'UNKNOWN'; confirmationCode: string; start: string; end: string; boxes: number };
export type PickupStatus = { day: string; booking: PickupBooking | null; today: PickupBooking | null; regular: { time: string } | null; boxes: number; allowed: boolean; zone: boolean };

const asBooking = (b: any): PickupBooking | null => (b ? { day: String(b.day || ''), status: (['CONFIRMED', 'PENDING', 'UNKNOWN'].includes(String(b.status)) ? b.status : 'CONFIRMED') as PickupBooking['status'], confirmationCode: String(b.confirmationCode || ''), start: String(b.start || ''), end: String(b.end || ''), boxes: Number(b.boxes) || 0 } : null);

/** Where a USPS pickup stands (api/retail/pickup): the day a booking would be for, any booking already made for it, and
 *  today's pickup. */
export async function pickupStatus(t: string): Promise<PickupStatus | null> {
  try {
    const r = await fetch('/api/retail/pickup', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId: t, action: 'status' }) });
    const d = await r.json().catch(() => ({}));
    return r.ok ? { day: String(d.day || ''), booking: asBooking(d.booking), today: asBooking(d.today), regular: d.regular || null, boxes: Number(d.boxes) || 0, allowed: d.allowed === true, zone: d.zone !== false } : null;
  } catch { return null; }
}

/** Books the pickup. `retry`: after USPS didn't answer, someone checked with USPS and it isn't booked. */
export async function bookPickup(t: string, retry = false): Promise<{ ok: boolean; booking?: PickupBooking; error?: string; unknown?: boolean }> {
  try {
    const r = await fetch('/api/retail/pickup', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId: t, action: 'book', ...(retry ? { retry: true } : {}) }) });
    const d = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, booking: asBooking(d.booking) || undefined } : { ok: false, error: d.error || 'The pickup didn’t book. Try again.', unknown: d.unknown === true, booking: asBooking(d.booking) || undefined };
  } catch { return { ok: false, error: 'Couldn’t reach the server. Check your connection.' }; }
}

/** The sheets for forms that were still being made, once they're ready (empty until then); `failed` counts forms
 *  Shippo couldn't make (their boxes go on the next one, and the carrier scans them meanwhile). */
export async function formsReady(t: string, ids: string[]): Promise<{ documents: string[]; pending: string[]; failed: number }> {
  try {
    const r = await fetch('/api/retail/close-day', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId: t, action: 'history' }) });
    const d = await r.json().catch(() => ({}));
    const mine = (d.manifests || []).filter((m: any) => ids.includes(String(m.id)));
    const bad = (m: any) => ['ERROR', 'FAILED'].includes(String(m.status || '').toUpperCase());
    return { documents: mine.flatMap((m: any) => m.documents || []), pending: mine.filter((m: any) => !(m.documents || []).length && !bad(m)).map((m: any) => String(m.id)), failed: mine.filter(bad).length };
  } catch { return { documents: [], pending: ids, failed: 0 }; }
}
