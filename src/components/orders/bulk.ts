'use client';
// src/components/orders/bulk.ts — WORK ON SEVERAL ORDERS AT ONCE. Print a pick list or packing slips for the chosen
// orders, buy labels for the packed ship orders among them, mark labelled ones as shipped, and hold or release
// orders for review. Each action reports what it did and what it skipped, in plain words.
import { addDoc, collection, doc, updateDoc, type Firestore } from 'firebase/firestore';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { openPrint } from '@/lib/open-print';
import { shipIt } from '@/lib/orders-flow';
import type { Actor } from '@/lib/retail-fulfill';

export const needsLabel = (o: any) => o.method === 'ship' && o.stage === 'packed' && !o.trackingNumber && !o.labelUrl;
export const canMarkShipped = (o: any) => o.method === 'ship' && o.stage === 'packed' && !!o.trackingNumber;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function printFor(t: string, orders: any[], show: 'picks' | 'slips'): Promise<string | null> {
  if (!orders.length) return 'Pick at least one order.';
  return openPrint(t, 'orders', `/print/orders/${t}?show=${show}&ids=${orders.map((o) => o.id).join(',')}`);
}

export async function printLabels(t: string, orders: any[]): Promise<string | null> {
  const ids = orders.filter((o) => o.labelUrl).map((o) => o.id);
  if (!ids.length) return 'None of these have a label yet.';
  return openPrint(t, 'orders', `/print/labels/${t}?ids=${ids.join(',')}`);
}

export async function buyLabels(t: string, orders: any[], rs: any): Promise<{ ok: boolean; message: string; boughtIds: string[] }> {
  const todo = orders.filter(needsLabel).slice(0, 25);
  if (!todo.length) return { ok: false, message: 'None of these are packed ship orders waiting for a label.', boughtIds: [] };
  const p = (rs?.packagingPresets || [])[0];
  try {
    const r = await fetch('/api/retail/shipping-labels-bulk', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) },
      body: JSON.stringify({ tenantId: t, orders: todo.map((o) => ({ orderId: o.id, qrToken: o.qrToken || '' })), parcelDefaults: p ? { lengthIn: p.lengthIn, widthIn: p.widthIn, heightIn: p.heightIn, boxWeightOz: p.weightOz } : undefined }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, message: d.error || 'The labels didn’t go through. Try again.', boughtIds: [] };
    const res: any[] = d.results || [];
    const bought = res.filter((x) => x.ok && !x.skipped && x.labelUrl).map((x) => x.orderId);
    const failed = res.filter((x) => !x.ok);
    const msg = `${plural(bought.length, 'label')} bought${failed.length ? `. ${plural(failed.length, 'order')} couldn’t get one: ${failed[0].error}` : '.'}`;
    return { ok: bought.length > 0, message: msg, boughtIds: bought };
  } catch { return { ok: false, message: 'The labels didn’t go through. Check your connection.', boughtIds: [] }; }
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

export async function closeDay(t: string): Promise<{ ok: boolean; message: string; documents: string[] }> {
  try {
    const r = await fetch('/api/retail/close-day', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId: t, action: 'manifest' }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, message: d.error || 'Couldn’t close the day. Try again.', documents: [] };
    const docs: string[] = (d.manifests || []).flatMap((m: any) => m.documents || []);
    return { ok: !!d.ok, message: `${d.message || ''}${d.others ? ` ${plural(d.others, 'box', 'boxes')} on other carriers get scanned at pickup.` : ''}`.trim(), documents: docs };
  } catch { return { ok: false, message: 'Couldn’t close the day. Check your connection.', documents: [] }; }
}
