// src/lib/label-sweep.ts — POSTAGE NOBODY USED, BACK IN THE SHOP'S POCKET. Server only.
// Shippo refunds an unused label only when someone asks (within 90 days), and a USPS label stops working after 30.
// Every morning (api/cron/shipping-checks), for labels bought in the last 90 days:
//   - a cancelled or refunded order's label is voided
//   - a label the carrier has never scanned after 28 days is voided (it's about to stop working anyway)
//   - a label not scanned for a few days is listed under Needs you, so someone looks for the box
// Nothing is voided on our own say-so: the carrier's tracking is checked first, and a label it ever scanned is left
// alone (a refund on a used label would be refused anyway, but by then the order would have lost its tracking).
import { LABEL_CLEARED, voidOrderLabels } from '@/lib/label-void';

const SHIPPO = 'https://api.goshippo.com';
const DAY = 86400e3;
const SCANNED = ['TRANSIT', 'DELIVERED', 'RETURNED', 'FAILURE'];
const timeout = (ms: number): AbortSignal | undefined => { try { return (AbortSignal as any).timeout(ms); } catch { return undefined; } };

/** Shippo's name for the carrier, for its tracking lookup. */
export function trackingCarrier(carrier: unknown): string {
  const c = String(carrier || '').trim().toLowerCase();
  if (c.includes('usps')) return 'usps';
  if (c.includes('ups')) return 'ups';
  if (c.includes('fedex')) return 'fedex';
  if (c.includes('dhl')) return 'dhl_express';
  if (c.includes('ontrac')) return 'ontrac';
  return c.replace(/[^a-z0-9_]/g, '_');
}

/** Did the carrier ever scan this tracking number? 'unknown' when the lookup fails. */
export async function scanned(apiKey: string, carrier: unknown, number: string): Promise<'yes' | 'no' | 'unknown'> {
  if (!apiKey || !number) return 'unknown';
  try {
    const r = await fetch(`${SHIPPO}/tracks/${encodeURIComponent(trackingCarrier(carrier))}/${encodeURIComponent(number)}`, { headers: { Authorization: `ShippoToken ${apiKey}` }, signal: timeout(15000) });
    if (!r.ok) return 'unknown';
    const d: any = await r.json().catch(() => null);
    if (!d) return 'unknown';
    const statuses = [d.tracking_status?.status, ...(Array.isArray(d.tracking_history) ? d.tracking_history.map((h: any) => h?.status) : [])].map((s) => String(s || '').toUpperCase());
    return statuses.some((s) => SCANNED.includes(s)) ? 'yes' : 'no';
  } catch { return 'unknown'; }
}

/** Every box of the order: never scanned only if no box was ever scanned (and every lookup worked). */
export async function neverScanned(apiKey: string, order: any): Promise<boolean> {
  const trail = String(order?.carrierTrail?.status || '').toUpperCase();
  if (SCANNED.includes(trail)) return false;
  if (Object.values(order?.boxStatus || {}).some((s: any) => SCANNED.includes(String(s).toUpperCase()))) return false;
  const numbers = [order?.trackingNumber, ...(Array.isArray(order?.extraTrackingNumbers) ? order.extraTrackingNumbers : [])].map((x: any) => String(x || '').trim()).filter(Boolean);
  if (!numbers.length) return false;
  for (const n of numbers) { if ((await scanned(apiKey, order.carrier, n)) !== 'no') return false; }
  return true;
}

/**
 * Void an order's labels if the carrier never scanned any of them; record it on the order. A shipped order whose label
 * never moved goes back to packed (it never left). Returns what happened.
 */
export async function voidIfUnused(db: any, tenantId: string, ref: any, order: any, apiKey: string, why: string, actor = { id: 'system', name: 'Daily check' }): Promise<{ ok: boolean; error?: string; voided?: number }> {
  if (!order?.shippoTransactionId) return { ok: true, voided: 0 };
  if (!(await neverScanned(apiKey, order))) return { ok: false, error: 'The carrier has scanned this label (or its tracking couldn’t be checked), so it was left alone.' };
  const v = await voidOrderLabels(db, tenantId, order, apiKey, { alreadyVoided: Array.isArray(order.labelVoidIds) ? order.labelVoidIds : [] });
  if (!v.ok) { if (v.voidedIds.length) await ref.set({ labelVoidIds: v.voidedIds }, { merge: true }).catch(() => {}); return { ok: false, error: v.error }; }
  const { FieldValue } = await import('firebase-admin/firestore');
  const now = new Date().toISOString();
  const txnId = String(order.shippoTransactionId);
  await db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(ref)).data() || {};
    if (String(cur.shippoTransactionId || '') !== txnId) return;   // relabelled meanwhile: that label isn't ours to clear
    tx.set(ref, {
      ...LABEL_CLEARED, labelVoidedAt: now,
      ...(v.trackingNumbers.length ? { voidedTracking: FieldValue.arrayUnion(...v.trackingNumbers) } : {}),
      ...(cur.stage === 'shipped' ? { stage: 'packed', completedAt: null } : {}),
    }, { merge: true });
    const ev = ref.collection('events').doc();
    tx.set(ev, { id: ev.id, type: 'note', at: now, actorId: actor.id, actorName: actor.name, meta: { kind: 'label_voided', text: `${v.count > 1 ? `${v.count} labels` : 'Label'} voided: ${why}. The postage comes back to the shop.` } });
  });
  return { ok: true, voided: v.count };
}

/** One shop's morning check. */
export async function sweepLabels(db: any, tenantId: string, apiKey: string, opts: { now?: number; maxLookups?: number } = {}): Promise<{ voided: number; flagged: number; checked: number }> {
  const now = opts.now ?? Date.now();
  const out = { voided: 0, flagged: 0, checked: 0 };
  if (!apiKey) return out;
  const since = new Date(now - 90 * DAY).toISOString();
  const col = db.collection(`tenants/${tenantId}/retailOrders`);
  const docs: any[] = []; let cursor: any = null;
  for (let page = 0; page < 20; page++) {
    let q = col.where('shipmentProtection.decidedAt', '>', since).orderBy('shipmentProtection.decidedAt', 'asc').limit(400);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get(); docs.push(...snap.docs);
    if (snap.size < 400) break; cursor = snap.docs[snap.docs.length - 1];
  }
  let lookups = 0; const maxLookups = opts.maxLookups ?? 40;
  for (const d of docs) {
    const o: any = d.data() || {};
    if (!o.shippoTransactionId || o.deliveredAt || ['completed', 'handed_off'].includes(String(o.stage))) continue;
    if (SCANNED.includes(String(o.carrierTrail?.status || '').toUpperCase())) continue;
    const bought = Date.parse(String(o.shipmentProtection?.decidedAt || '')) || now;
    const age = (now - bought) / DAY;
    const cancelled = ['cancelled', 'refunded'].includes(String(o.stage));
    if (lookups >= maxLookups) break;
    if (cancelled || age >= 28) {
      lookups++; out.checked++;
      const r = await voidIfUnused(db, tenantId, d.ref, o, apiKey, cancelled ? 'the order was cancelled' : 'the carrier never scanned it, and USPS labels stop working after 30 days');
      if (r.ok && r.voided) out.voided++;
      continue;
    }
    // Not scanned for a while: someone should look for the box (or the carrier missed a scan).
    const shippedAt = Date.parse(String(o.completedAt || '')) || 0;
    const due = o.stage === 'shipped' ? shippedAt && now - shippedAt >= 4 * DAY : o.stage === 'packed' && age >= 3;
    if (!due || o.labelUnscanned?.dismissedAt || o.labelUnscanned?.at) continue;
    lookups++; out.checked++;
    if (await neverScanned(apiKey, o)) {
      await d.ref.set({ labelUnscanned: { at: new Date(now).toISOString(), boughtAt: o.shipmentProtection?.decidedAt || null }, labelUnscannedOpen: true }, { merge: true });
      out.flagged++;
    }
  }
  return out;
}
