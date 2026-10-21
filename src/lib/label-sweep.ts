// src/lib/label-sweep.ts — POSTAGE NOBODY USED, BACK IN THE SHOP'S POCKET. Server only.
// Shippo refunds an unused label only when someone asks (within 90 days), and a USPS label stops working after 30.
// Every morning (api/cron/shipping-checks), for labels bought in the last 90 days, in this order:
//   1. a void that was interrupted is finished
//   2. a cancelled or refunded order's label is voided
//   3. a label not scanned for a few days is listed under Needs you, so someone looks for the box (never voided)
//   4. a packed order's label the carrier has never scanned after 28 days is voided (it's about to stop working)
// Shipped orders are only ever listed, never voided: the box may well be out there.
//
// NOTHING IS VOIDED ON A GUESS. Before any automatic void the carrier's own tracking must show the label as created
// and nothing more (every status PRE_TRANSIT). "Not found", a lookup that fails, or a carrier we can't look up all
// count as unknown, and unknown is left alone. A label on a USPS form, or one shared by orders shipped together, is
// never voided automatically. A staff member voiding by hand gets the gentler test: refused only if the carrier has
// scanned it. A void about to start is written down first, so one interrupted part way is finished next morning.
import { LABEL_CLEARED, voidOrderLabels } from '@/lib/label-void';

const SHIPPO = 'https://api.goshippo.com';
const DAY = 86400e3;
const SCANNED = ['TRANSIT', 'DELIVERED', 'RETURNED', 'FAILURE'];
const timeout = (ms: number): AbortSignal | undefined => { try { return (AbortSignal as any).timeout(ms); } catch { return undefined; } };

// Shippo's codes for the carriers' tracking. A carrier not listed here is never looked up (so never voided by us).
const CODES: [RegExp, string][] = [
  [/\busps\b/i, 'usps'], [/\bups\b/i, 'ups'], [/fedex/i, 'fedex'], [/dhl\s*e-?commerce/i, 'dhl_ecommerce'], [/dhl/i, 'dhl_express'],
  [/ontrac/i, 'ontrac'], [/lasership/i, 'lasership'], [/canada\s*post/i, 'canada_post'], [/purolator/i, 'purolator'],
];
export function trackingCarrier(carrier: unknown): string | null {
  const c = String(carrier || '');
  for (const [re, code] of CODES) if (re.test(c)) return code;
  return null;
}

export type LabelState = 'moving' | 'pre' | 'unknown';

/** What the carrier says about one tracking number: moving (scanned), pre (label created, nothing more), or unknown. */
export async function trackState(apiKey: string, carrier: unknown, number: string): Promise<LabelState> {
  const code = trackingCarrier(carrier);
  if (!apiKey || !number || !code) return 'unknown';
  try {
    const r = await fetch(`${SHIPPO}/tracks/${encodeURIComponent(code)}/${encodeURIComponent(number)}`, { headers: { Authorization: `ShippoToken ${apiKey}` }, signal: timeout(10000) });
    if (!r.ok) return 'unknown';
    const d: any = await r.json().catch(() => null);
    if (!d) return 'unknown';
    const statuses = [d.tracking_status?.status, ...(Array.isArray(d.tracking_history) ? d.tracking_history.map((h: any) => h?.status) : [])]
      .map((s) => String(s || '').toUpperCase()).filter(Boolean);
    if (statuses.some((s) => SCANNED.includes(s))) return 'moving';
    if (statuses.length && statuses.every((s) => s === 'PRE_TRANSIT')) return 'pre';
    return 'unknown';
  } catch { return 'unknown'; }
}

/** Every box of the order: moving if any box was scanned; pre only if every box is label-created and nothing more. */
export async function labelState(apiKey: string, order: any): Promise<LabelState> {
  if (SCANNED.includes(String(order?.carrierTrail?.status || '').toUpperCase())) return 'moving';
  if (Object.values(order?.boxStatus || {}).some((s: any) => SCANNED.includes(String(s).toUpperCase()))) return 'moving';
  if (order?.labelSeenMoving) return 'moving';
  const numbers = [order?.trackingNumber, ...(Array.isArray(order?.extraTrackingNumbers) ? order.extraTrackingNumbers : [])].map((x: any) => String(x || '').trim()).filter(Boolean);
  if (!numbers.length) return 'unknown';
  let all = true;
  for (const n of numbers) {
    const s = await trackState(apiKey, order.carrier, n);
    if (s === 'moving') return 'moving';
    if (s !== 'pre') all = false;
  }
  return all ? 'pre' : 'unknown';
}

/** Strict: the carrier shows every box as created and nothing more. */
export async function neverScanned(apiKey: string, order: any): Promise<boolean> {
  return (await labelState(apiKey, order)) === 'pre';
}

const shared = (o: any) => Array.isArray(o?.shippedWithOrderIds) && o.shippedWithOrderIds.length > 0;

/**
 * Void an order's labels if they weren't used, and clear them from the order. Automatic voids (the default) need the
 * strict test and are refused for a label on a USPS form; `byHand` is a staff member standing at the box, refused only
 * when the carrier has scanned it. A shared label (orders shipped together) is never voided here. The stage never
 * changes: a shipped order stays shipped.
 */
export async function voidIfUnused(db: any, tenantId: string, ref: any, order: any, apiKey: string, why: string,
  actor = { id: 'system', name: 'Daily check' }, opts: { byHand?: boolean; finishing?: boolean } = {}): Promise<{ ok: boolean; error?: string; voided?: number }> {
  if (!order?.shippoTransactionId) return { ok: true, voided: 0 };
  if (shared(order)) return { ok: false, error: 'This label covers other orders in the same box, so it can’t be voided on its own.' };
  // Finishing a void that already passed its checks (and may already be refunded): only a scan since stops it.
  const careful = !opts.byHand && !opts.finishing;
  if (careful && order.manifestId) return { ok: false, error: 'This box is on a USPS form, so it may already have gone out. It was left alone.' };
  const state = await labelState(apiKey, order);
  if (state === 'moving') {
    await ref.set({ labelSeenMoving: new Date().toISOString(), labelUnscannedOpen: false, labelVoiding: null,
      ...(opts.finishing ? { voidedLabelMoving: { at: new Date().toISOString(), trackingNumber: String(order.trackingNumber || '') } } : {}) }, { merge: true }).catch(() => {});
    return { ok: false, error: 'The carrier has already scanned this label, so it can’t be voided.' };
  }
  if (careful && state !== 'pre') return { ok: false, error: 'The carrier’s tracking couldn’t confirm this label is unused, so it was left alone.' };

  const txnId = String(order.shippoTransactionId);
  const now = new Date().toISOString();
  // Written down first: if this stops part way, the next morning's check finishes it.
  await ref.set({ labelVoiding: { at: now, txn: txnId, why } }, { merge: true });
  const v = await voidOrderLabels(db, tenantId, order, apiKey, { alreadyVoided: Array.isArray(order.labelVoidIds) ? order.labelVoidIds : [] });
  if (!v.ok) { if (v.voidedIds.length) await ref.set({ labelVoidIds: v.voidedIds }, { merge: true }).catch(() => {}); return { ok: false, error: v.error }; }
  const { FieldValue } = await import('firebase-admin/firestore');
  await db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(ref)).data() || {};
    if (String(cur.shippoTransactionId || '') !== txnId) return;   // relabelled meanwhile: that label isn't ours to clear
    tx.set(ref, {
      ...LABEL_CLEARED, labelVoidedAt: now,
      ...(v.trackingNumbers.length ? { voidedTracking: FieldValue.arrayUnion(...v.trackingNumbers) } : {}),
    }, { merge: true });
    const ev = ref.collection('events').doc();
    tx.set(ev, { id: ev.id, type: 'note', at: now, actorId: actor.id, actorName: actor.name, meta: { kind: 'label_voided', text: `${v.count > 1 ? `${v.count} labels` : 'Label'} voided: ${why}. The postage comes back to the shop.` } });
  });
  return { ok: true, voided: v.count };
}

/** One shop's morning check. Stops starting new work 20 seconds before `deadline`. */
export async function sweepLabels(db: any, tenantId: string, apiKey: string, opts: { now?: number; deadline?: number; maxLookups?: number } = {}): Promise<{ voided: number; flagged: number; checked: number }> {
  const now = opts.now ?? Date.now();
  const deadline = opts.deadline ?? Date.now() + 40000;
  const out = { voided: 0, flagged: 0, checked: 0 };
  if (!apiKey) return out;
  const since = new Date(now - 90 * DAY).toISOString();
  const col = db.collection(`tenants/${tenantId}/retailOrders`);
  const docs: any[] = []; let cursor: any = null;
  for (let page = 0; page < 20; page++) {
    let q = col.where('shipmentProtection.decidedAt', '>', since).orderBy('shipmentProtection.decidedAt', 'desc').limit(400);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get(); docs.push(...snap.docs);
    if (snap.size < 400) break; cursor = snap.docs[snap.docs.length - 1];
  }
  type Job = { d: any; o: any; kind: 'finish' | 'cancelled' | 'flag' | 'expired'; at: number };
  const jobs: Job[] = [];
  for (const d of docs) {
    const o: any = d.data() || {};
    if (!o.shippoTransactionId || o.deliveredAt || ['completed', 'handed_off'].includes(String(o.stage))) continue;
    if (o.labelSeenMoving || SCANNED.includes(String(o.carrierTrail?.status || '').toUpperCase())) continue;
    if (shared(o)) continue;
    const bought = Date.parse(String(o.shipmentProtection?.decidedAt || '')) || now;
    const age = (now - bought) / DAY;
    if (o.labelVoiding?.txn && o.labelVoiding.txn === o.shippoTransactionId) { jobs.push({ d, o, kind: 'finish', at: bought }); continue; }
    if (['cancelled', 'refunded'].includes(String(o.stage))) { jobs.push({ d, o, kind: 'cancelled', at: bought }); continue; }
    const dismissed = !!o.labelUnscanned?.dismissedAt;
    const shippedAt = Date.parse(String(o.completedAt || '')) || 0;
    const due = o.stage === 'shipped' ? shippedAt > 0 && now - shippedAt >= 4 * DAY : o.stage === 'packed' && age >= 3;
    if (o.stage === 'packed' && age >= 28 && !dismissed && !o.manifestId) jobs.push({ d, o, kind: 'expired', at: bought });
    else if (due && !dismissed && !o.labelUnscanned?.at) jobs.push({ d, o, kind: 'flag', at: bought });
  }
  const rank = { finish: 0, cancelled: 1, flag: 2, expired: 3 } as const;
  jobs.sort((a, b) => rank[a.kind] - rank[b.kind] || b.at - a.at);
  let lookups = 0; const maxLookups = opts.maxLookups ?? 40;
  for (const j of jobs) {
    if (lookups >= maxLookups || Date.now() > deadline - 20000) break;
    lookups++; out.checked++;
    if (j.kind === 'flag') {
      const s = await labelState(apiKey, j.o);
      if (s === 'moving') { await j.d.ref.set({ labelSeenMoving: new Date().toISOString() }, { merge: true }); continue; }
      await j.d.ref.set({ labelUnscanned: { at: new Date(now).toISOString(), boughtAt: j.o.shipmentProtection?.decidedAt || null }, labelUnscannedOpen: true }, { merge: true });
      out.flagged++;
      continue;
    }
    const why = j.kind === 'cancelled' ? 'the order was cancelled'
      : j.kind === 'expired' ? 'the carrier never scanned it, and USPS labels stop working after 30 days'
      : String(j.o.labelVoiding?.why || 'finishing a void that was interrupted');
    const r = await voidIfUnused(db, tenantId, j.d.ref, j.o, apiKey, why, undefined, { finishing: j.kind === 'finish' });
    if (r.ok && r.voided) out.voided++;
  }
  return out;
}
