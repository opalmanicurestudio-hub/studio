// src/lib/label-records.ts — EVERY LABEL, KEPT. Server only.
// Each label bought through Shippo gets a record (tenants/{t}/shippingLabels/{id}, id = its first box's Shippo label):
// the order it's for (and any shipped in the same box), every box's label and tracking, what it cost, who bought it
// and why (a replacement names the label it replaced and the reason), and what happened to the money since:
//   · a void asks Shippo for a refund of each box's share; the request is written here, not in the books
//   · every morning (api/cron/label-money) each refund still waiting is checked with Shippo. A confirmed refund goes
//     into the books as income, once; one Shippo turned down goes under Needs you (the box may well have gone out);
//     one Shippo never registered (it didn't answer when asked) is asked for again, up to four times; one Shippo still
//     has no refund for after that, or one still unanswered after 45 days, is listed for someone to check in Shippo
//   · a carrier adjustment on Shippo's invoices (the carrier weighed or measured a box differently, say) is matched to
//     its label, recorded here and in the books, and shown on the order
// Labels bought before these records existed get one the first time they're voided or charged for, so they're
// followed the same way from then on.
import { createHash } from 'crypto';
import { boxShare, labelKey, labelSlots, slotsKnown, type Parcel, type RecordBox } from './label-boxes';
import { recordCarrierCharge, recordPostageRefund } from './postage';

const SHIPPO = 'https://api.goshippo.com';
const DAY = 86400e3;
const timeout = (ms: number): AbortSignal | undefined => { try { return (AbortSignal as any).timeout(ms); } catch { return undefined; } };
const iso = (ms: number) => new Date(ms).toISOString();
const orderNo = (o: any) => `#${String(o?.orderNumber ?? '').padStart(4, '0')}`;

export const labelsCol = (t: string) => `tenants/${t}/shippingLabels`;
/** How long a refund is followed before it's handed to a person to check in Shippo. */
export const REFUND_FOLLOW_DAYS = 45;

export type LabelHow = 'single' | 'bulk' | 'replace' | 'box' | 'earlier';
/** requested: waiting on Shippo. refunded / denied: Shippo's answer. unconfirmed: no answer after 45 days, for someone to
 *  check in Shippo. refused: Shippo wouldn't void it when asked, so nothing is coming back. withdrawn: the void was
 *  called off (the carrier had the box), so the label stayed in use. */
export type RefundEntry = {
  status: 'requested' | 'refunded' | 'denied' | 'unconfirmed' | 'refused' | 'withdrawn';
  requestedAt: string; cents: number; slot: number | null; refundId: string | null;
  checkedAt?: string | null; doneAt?: string | null; asks?: number; tracking?: string; why?: string;
};

export function newLabelRecord(p: {
  id: string; order: any; orderId: string; orderIds?: string[]; carrier: string; service?: string; rateId?: string;
  boxes: RecordBox[]; amountCents: number; protection?: { signature?: unknown; insuranceCents?: number } | null;
  at: string; by: { id: string; name: string }; how: LabelHow;
  /** The label it replaces (`slot`: just that box). `ids`: every label it replaces, when the old boxes were bought on
   *  more than one (a box had already had its own new label). */
  replaces?: { id: string; slot?: number | null; ids?: string[] } | null; reason?: { kind: string; note?: string } | null;
}): Record<string, any> {
  return {
    id: p.id, orderId: p.orderId, orderIds: [...new Set([p.orderId, ...(p.orderIds || [])].filter(Boolean))],
    orderNumber: typeof p.order?.orderNumber === 'number' ? p.order.orderNumber : null,
    customerName: String(p.order?.customerName || ''),
    carrier: String(p.carrier || ''), service: String(p.service || ''), rateId: String(p.rateId || ''),
    boxes: p.boxes.map((b) => ({ txn: b.txn, tracking: b.tracking, labelUrl: b.labelUrl, trackingUrl: b.trackingUrl, parcel: b.parcel || null, replacedBy: null })),
    boxTxns: p.boxes.map((b) => b.txn).filter(Boolean),
    amountCents: Math.max(0, Math.round(Number(p.amountCents) || 0)),
    protection: p.protection ? { signature: String(p.protection.signature ?? 'NONE'), insuranceCents: Math.max(0, Math.round(Number(p.protection.insuranceCents) || 0)) } : null,
    boughtAt: p.at, boughtBy: { id: String(p.by?.id || ''), name: String(p.by?.name || '') }, how: p.how,
    replaces: p.replaces ? { id: p.replaces.id, slot: p.replaces.slot ?? null, ...(p.replaces.ids && p.replaces.ids.length > 1 ? { ids: [...new Set(p.replaces.ids)] } : {}) } : null, replacedBy: null, replacedAt: null,
    reason: p.reason ? { kind: String(p.reason.kind || ''), note: String(p.reason.note || '').slice(0, 300) } : null,
    voidedAt: null, voidWhy: null,
    refunds: {}, refundOpen: false, refundCents: 0, refundedCents: 0, deniedCents: 0, deniedOpen: false, unconfirmedOpen: false,
    charges: {}, chargesCents: 0, chargeOpen: false,
    updatedAt: p.at,
  };
}

const get = async (apiKey: string, path: string): Promise<any> => {
  const r = await fetch(`${SHIPPO}${path}`, { headers: { Authorization: `ShippoToken ${apiKey}` }, signal: timeout(15000) });
  if (!r.ok) throw new Error(`Shippo ${r.status}`);
  return r.json();
};

/** A rate's price in cents, its shipment, and its carrier and service. */
export async function rateInfo(apiKey: string, rateId: string): Promise<{ cents: number; shipment: string; provider: string; service: string }> {
  try {
    const d = await get(apiKey, `/rates/${encodeURIComponent(rateId)}`);
    const c = Math.round(parseFloat(d?.amount) * 100);
    return { cents: Number.isFinite(c) ? c : 0, shipment: String(d?.shipment || ''), provider: String(d?.provider || ''), service: String(d?.servicelevel?.name || d?.servicelevel?.token || '') };
  } catch { return { cents: 0, shipment: '', provider: '', service: '' }; }
}

const toParcel = (p: any): Parcel | null => {
  if (!p) return null;
  const unit = String(p.mass_unit || 'oz').toLowerCase();
  const w = Number(p.weight ?? p.weightOz); const len = Number(p.length ?? p.lengthIn); const wid = Number(p.width ?? p.widthIn); const h = Number(p.height ?? p.heightIn);
  if (!Number.isFinite(w) || w <= 0) return null;
  const inch = String(p.distance_unit || 'in').toLowerCase() === 'cm' ? 1 / 2.54 : 1;
  return { lengthIn: Math.round((len || 0) * inch * 10) / 10, widthIn: Math.round((wid || 0) * inch * 10) / 10, heightIn: Math.round((h || 0) * inch * 10) / 10, weightOz: Math.round(unit === 'lb' ? w * 16 : unit === 'kg' ? w * 35.274 : unit === 'g' ? w / 28.35 : w) };
};

/**
 * Every box a label just bought covers, first box first, one Shippo label each. A label for several boxes is one rate,
 * so the other boxes' labels are found through it and put in the order their parcels were given, each with the size
 * and weight it was bought for. A listing that fails costs only the other boxes' labels, never the purchase.
 */
export async function boxesOf(apiKey: string, master: any, rateId: string, parcels: any[], shipmentId = ''): Promise<RecordBox[]> {
  const sent = (Array.isArray(parcels) ? parcels : []).map(toParcel);
  const box = (t: any, parcel: Parcel | null): RecordBox => ({ txn: String(t?.object_id || ''), tracking: String(t?.tracking_number || ''), labelUrl: String(t?.label_url || ''), trackingUrl: String(t?.tracking_url_provider || ''), parcel });
  let others: any[] = [];
  try {
    const list = await get(apiKey, `/transactions/?rate=${encodeURIComponent(rateId)}&results=25`);
    others = (list?.results || []).filter((t: any) => t?.status === 'SUCCESS' && t.object_id && t.object_id !== master?.object_id && t.label_url);
  } catch { /* the first box is still bought */ }
  if (!others.length) return [box(master, sent[0] || null)];
  // Which parcel each label is for, from the shipment, so box 2 is the second parcel given.
  let order: string[] = []; let dims = new Map<string, Parcel | null>();
  try {
    const sid = shipmentId || (await rateInfo(apiKey, rateId)).shipment;
    if (sid) {
      const s = await get(apiKey, `/shipments/${encodeURIComponent(sid)}`);
      const ps: any[] = Array.isArray(s?.parcels) ? s.parcels : [];
      order = ps.map((p: any) => String(p?.object_id || ''));
      dims = new Map(ps.map((p: any) => [String(p?.object_id || ''), toParcel(p)]));
    }
  } catch { /* listing order, sizes from what was sent */ }
  const pos = (t: any) => { const i = order.indexOf(String(t?.parcel?.object_id || t?.parcel || '')); return i < 0 ? 1e6 : i; };
  const sorted = [...others].sort((a, b) => pos(a) - pos(b));
  const parcelFor = (t: any, i: number) => dims.get(String(t?.parcel?.object_id || t?.parcel || '')) || sent[i] || null;
  return [box(master, parcelFor(master, 0)), ...sorted.map((t, i) => box(t, parcelFor(t, i + 1)))];
}

/** A record for a label bought before records existed, from the order as it is: once, then followed like any other. */
async function earlierRecord(db: any, tenantId: string, tx: any, order: any, orderId: string, id: string, now: string): Promise<Record<string, any>> {
  let cents = 0;
  try {
    const s = await tx.get(db.doc(`tenants/${tenantId}/transactions/postage-${id}`));
    if (s.exists) cents = Math.round((Number(s.data()?.amount) || 0) * 100);
  } catch { /* unknown cost */ }
  const known = slotsKnown(order);
  const boxes: RecordBox[] = labelSlots(order).map((s, i) => ({ txn: known || i === 0 ? s.txn : '', tracking: s.tracking, labelUrl: s.labelUrl, trackingUrl: s.trackingUrl, parcel: null }));
  return newLabelRecord({
    id, order, orderId, orderIds: Array.isArray(order?.shippedWithOrderIds) ? order.shippedWithOrderIds.map(String) : [],
    carrier: String(order?.carrier || ''), boxes, amountCents: cents,
    protection: order?.shipmentProtection ? { signature: order.shipmentProtection.signature, insuranceCents: order.shipmentProtection.insuranceCents } : null,
    at: String(order?.shipmentProtection?.decidedAt || now), by: { id: '', name: '' }, how: 'earlier',
  });
}

/** Which label record each of an order's boxes belongs to, and its tracking. */
function recordsFor(order: any, txns: string[]): Map<string, { txn: string; tracking: string }[]> {
  const slots = labelSlots(order);
  const known = slotsKnown(order);
  const master = String(order?.shippoTransactionId || slots[0]?.txn || '');
  const groups = new Map<string, { txn: string; tracking: string }[]>();
  for (const t of txns) {
    const txn = String(t || ''); if (!txn) continue;
    const s = known ? slots.find((x) => x.txn === txn) : null;
    const rec = (s && s.record) || labelKey(master);
    if (!rec) continue;
    const g = groups.get(rec) || []; g.push({ txn, tracking: s?.tracking || (txn === master ? String(order?.trackingNumber || '') : '') }); groups.set(rec, g);
  }
  return groups;
}

/**
 * Refunds just asked for (each box voided in this go), written on the label records they belong to, with each box's
 * share of the price. A box already on its record isn't asked for twice. Not in the books yet: that waits for Shippo
 * to confirm (followRefunds). A box Shippo wouldn't void (`refused`, with its words) is written down too, as postage
 * that isn't coming back.
 */
export async function noteRefundRequests(db: any, tenantId: string, order: any, orderId: string, asked: { txn: string; refundId?: string | null; refused?: string }[], why = ''): Promise<void> {
  if (!asked.length || !orderId) return;
  const byTxn = new Map(asked.map((a) => [String(a.txn || ''), a]));
  const now = new Date().toISOString();
  for (const [id, list] of recordsFor(order, asked.map((a) => a.txn))) {
    try {
      await db.runTransaction(async (tx: any) => {
        const ref = db.doc(`${labelsCol(tenantId)}/${id}`);
        const snap = await tx.get(ref);
        const rec: any = snap.exists ? snap.data() : await earlierRecord(db, tenantId, tx, order, orderId, id, now);
        const refunds: Record<string, RefundEntry> = { ...(rec.refunds || {}) };
        const n = Math.max(1, (rec.boxes || []).length);
        let added = 0;
        for (const b of list) {
          if (refunds[b.txn] && refunds[b.txn].status !== 'withdrawn') continue;
          const a = byTxn.get(b.txn);
          const i = (rec.boxTxns || []).indexOf(b.txn);
          const cents = boxShare(rec.amountCents, n, i < 0 ? 0 : i);
          const refused = String(a?.refused || '');
          refunds[b.txn] = { status: refused ? 'refused' : 'requested', requestedAt: now, cents, slot: i < 0 ? null : i, refundId: a?.refundId ? String(a.refundId) : null, checkedAt: null, doneAt: refused ? now : null, asks: 1, tracking: b.tracking || String(rec.boxes?.[i]?.tracking || ''), ...(refused ? { why: refused.slice(0, 160) } : {}) };
          if (!refused) added += cents;
        }
        const all = (rec.boxTxns || []).length > 0 && (rec.boxTxns || []).every((t: string) => !!refunds[t] && refunds[t].status !== 'withdrawn');
        tx.set(ref, {
          ...(snap.exists ? {} : rec),
          refunds, refundOpen: Object.values(refunds).some((r) => r.status === 'requested'), refundCents: (Number(rec.refundCents) || 0) + added,
          ...(all ? { voidedAt: rec.voidedAt || now, voidWhy: rec.voidWhy || why || null } : {}),
          updatedAt: now,
        }, { merge: true });
      });
    } catch (e: any) { console.error('[label-records] refund note', tenantId, id, String(e?.message || e).slice(0, 200)); }
  }
}

/** Called off: a box's refund was written down before asking Shippo, and Shippo said no because the carrier has the
 *  box. Its label is still in use, so nothing is coming back, and the label no longer counts as voided as a whole. */
export async function withdrawRefund(db: any, tenantId: string, order: any, txn: string, why: string): Promise<void> {
  const now = new Date().toISOString();
  for (const [id] of recordsFor(order, [txn])) {
    await db.runTransaction(async (tx: any) => {
      const ref = db.doc(`${labelsCol(tenantId)}/${id}`);
      const cur: any = (await tx.get(ref)).data();
      const e: RefundEntry | undefined = cur?.refunds?.[txn];
      if (!e || e.status !== 'requested') return;
      const refunds = { ...(cur.refunds || {}), [txn]: { ...e, status: 'withdrawn', doneAt: now, why: why.slice(0, 160) } };
      const txns: string[] = Array.isArray(cur.boxTxns) ? cur.boxTxns : [];
      const all = txns.length > 0 && txns.every((t) => !!refunds[t] && refunds[t].status !== 'withdrawn');
      tx.set(ref, { refunds, refundOpen: Object.values(refunds).some((r: any) => r.status === 'requested'), refundCents: Math.max(0, (Number(cur.refundCents) || 0) - (Number(e.cents) || 0)),
        ...(all ? {} : { voidedAt: null, voidWhy: null }), updatedAt: now }, { merge: true });
    }).catch(() => {});
  }
}

/** Shippo's refund id, once it answers. */
export async function noteRefundId(db: any, tenantId: string, order: any, txn: string, refundId: string): Promise<void> {
  if (!refundId) return;
  for (const [id] of recordsFor(order, [txn])) await patchRefund(db, db.doc(`${labelsCol(tenantId)}/${id}`), txn, (e) => ({ ...e, refundId }));
}

type RefundState = 'refunded' | 'denied' | 'pending' | 'none' | 'unknown';

/** What Shippo says about a refund: the label's own status first, then the refund's when the label doesn't say. */
export async function refundState(apiKey: string, txn: string, refundId: string | null): Promise<RefundState> {
  try {
    const t = await get(apiKey, `/transactions/${encodeURIComponent(txn)}`);
    const s = String(t?.status || t?.object_status || '').toUpperCase();
    if (s === 'REFUNDED') return 'refunded';
    if (s === 'REFUNDREJECTED') return 'denied';
    if (s === 'REFUNDPENDING') return 'pending';
    if (refundId) {
      const r = await get(apiKey, `/refunds/${encodeURIComponent(refundId)}`);
      const rs = String(r?.status || r?.object_status || '').toUpperCase();
      if (rs === 'SUCCESS') return 'refunded';
      if (rs === 'ERROR') return 'denied';
      return 'pending';
    }
    return s === 'SUCCESS' ? 'none' : 'unknown';
  } catch { return 'unknown'; }
}

const IN_USE = /\bused\b|scanned|in transit/i;
const ALREADY = /already (been )?refunded|refund[^.]{0,40}already exists|already (has|have) a refund|refund (was|has been) already requested/i;

/** Ask Shippo again for a refund it never registered. */
async function askAgain(apiKey: string, txn: string): Promise<{ ok: boolean; refundId?: string; used?: boolean }> {
  try {
    const r = await fetch(`${SHIPPO}/refunds/`, { method: 'POST', headers: { Authorization: `ShippoToken ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ transaction: txn, async: false }), signal: timeout(15000) });
    const d: any = await r.json().catch(() => ({}));
    const said = String(d?.detail || d?.__all__?.[0] || d?.transaction?.[0] || '');
    if (r.ok) return { ok: true, refundId: String(d?.object_id || '') || undefined };
    if (ALREADY.test(said)) return { ok: true };
    return { ok: false, used: IN_USE.test(said) };
  } catch { return { ok: false }; }
}

export type RefundRun = { checked: number; refunded: number; denied: number; asked: number; cutOff: boolean };

/** One shop's refunds still waiting on Shippo, each checked at most once a day, the one checked longest ago first, so
 *  none waits behind the others however many there are. */
export async function followRefunds(db: any, tenantId: string, apiKey: string, opts: { now?: number; deadline?: number; maxLookups?: number } = {}): Promise<RefundRun> {
  const now = opts.now ?? Date.now();
  const deadline = opts.deadline ?? Date.now() + 40000;
  const out: RefundRun = { checked: 0, refunded: 0, denied: 0, asked: 0, cutOff: false };
  if (!apiKey) return out;
  const max = opts.maxLookups ?? 80;
  const due: { ref: any; txn: string; e: RefundEntry }[] = [];
  let after: any = null;
  for (let page = 0; page < 20; page++) {
    let q = db.collection(labelsCol(tenantId)).where('refundOpen', '==', true).orderBy('__name__').limit(300);
    if (after) q = q.startAfter(after);
    const snap = await q.get();
    for (const d of snap.docs) {
      for (const [txn, e] of Object.entries(((d.data() || {}).refunds || {}) as Record<string, RefundEntry>)) {
        if (e?.status === 'requested' && now - (Date.parse(String(e.checkedAt || '')) || 0) >= 20 * 3600e3) due.push({ ref: d.ref, txn, e });
      }
    }
    if (snap.docs.length < 300) break;
    after = snap.docs[snap.docs.length - 1];
  }
  due.sort((a, b) => (Date.parse(String(a.e.checkedAt || '')) || 0) - (Date.parse(String(b.e.checkedAt || '')) || 0)
    || (Date.parse(String(a.e.requestedAt || '')) || 0) - (Date.parse(String(b.e.requestedAt || '')) || 0));
  for (const { ref, txn, e: r } of due) {
    if (out.checked >= max || Date.now() > deadline - 10000) { out.cutOff = true; return out; }
    out.checked++;
    const state = await refundState(apiKey, txn, r.refundId || null);
    const age = now - (Date.parse(String(r.requestedAt || '')) || now);
    if (state === 'refunded') { if (await settleRefund(db, tenantId, ref, txn, 'refunded', now)) out.refunded++; continue; }
    if (state === 'denied') { if (await settleRefund(db, tenantId, ref, txn, 'denied', now)) out.denied++; continue; }
    // Shippo has no refund for it: the first ask got no answer, never reached it, or was turned away. Asked again, a few
    // times; after the fourth it goes to someone to check in Shippo straight away, not after 45 days.
    if (state === 'none' && age >= DAY) {
      if ((Number(r.asks) || 1) >= 4) { await settleRefund(db, tenantId, ref, txn, 'unconfirmed', now); continue; }
      const again = await askAgain(apiKey, txn);
      if (again.used) { if (await settleRefund(db, tenantId, ref, txn, 'denied', now)) out.denied++; continue; }
      out.asked++;
      await patchRefund(db, ref, txn, (e) => ({ ...e, checkedAt: iso(now), asks: (Number(e.asks) || 1) + 1, ...(again.refundId ? { refundId: again.refundId } : {}) }));
      continue;
    }
    if (age >= REFUND_FOLLOW_DAYS * DAY) { await settleRefund(db, tenantId, ref, txn, 'unconfirmed', now); continue; }
    await patchRefund(db, ref, txn, (e) => ({ ...e, checkedAt: iso(now) }));
  }
  return out;
}

async function patchRefund(db: any, ref: any, txn: string, fn: (e: RefundEntry) => RefundEntry): Promise<void> {
  await db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(ref)).data() || {};
    const e = cur.refunds?.[txn]; if (!e || e.status !== 'requested') return;
    tx.set(ref, { refunds: { [txn]: fn(e) } }, { merge: true });
  }).catch(() => {});
}

/** A refund's answer: into the books once confirmed (before the record says so, so a stop between the two is picked
 *  up next time and the books aren't written twice), under Needs you when it's turned down. */
async function settleRefund(db: any, tenantId: string, ref: any, txn: string, to: 'refunded' | 'denied' | 'unconfirmed', now: number): Promise<boolean> {
  const at = iso(now);
  const before: any = (await ref.get()).data() || {};
  const e: RefundEntry | undefined = before.refunds?.[txn];
  if (!e || e.status !== 'requested') return false;
  const boxes = Math.max(1, (before.boxes || []).length);
  const holder = String(before.orderId || '');
  // Not written to the books (the database didn't take it): left as it is, and tried again next time.
  if (to === 'refunded' && !(await recordPostageRefund(db, tenantId, { id: holder, orderNumber: before.orderNumber }, txn, e.cents, String(before.carrier || 'Carrier'), boxes > 1 && e.slot != null ? `box ${e.slot + 1} of ${boxes}` : ''))) return false;
  const done = await db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(ref)).data() || {};
    const c: RefundEntry | undefined = cur.refunds?.[txn];
    if (!c || c.status !== 'requested') return false;
    const refunds = { ...(cur.refunds || {}), [txn]: { ...c, status: to, doneAt: at, checkedAt: at } };
    tx.set(ref, {
      refunds, refundOpen: Object.values(refunds).some((r: any) => r.status === 'requested'),
      ...(to === 'refunded' ? { refundedCents: (Number(cur.refundedCents) || 0) + c.cents } : {}),
      ...(to === 'denied' ? { deniedCents: (Number(cur.deniedCents) || 0) + c.cents, deniedOpen: true, denied: { txn, tracking: c.tracking || '', cents: c.cents, at } } : {}),
      ...(to === 'unconfirmed' ? { unconfirmedOpen: true } : {}),
      updatedAt: at,
    }, { merge: true });
    if (holder && to !== 'unconfirmed') {
      const oRef = db.doc(`tenants/${tenantId}/retailOrders/${holder}`);
      const ev = oRef.collection('events').doc(`label-refund-${to}-${txn}`);
      const which = c.tracking ? `the label ending ${String(c.tracking).slice(-4)}` : 'a voided label';
      tx.set(ev, { id: ev.id, type: 'note', at, actorId: 'shippo', actorName: 'Shippo', meta: { kind: to === 'refunded' ? 'label_refunded' : 'label_refund_denied', labelId: ref.id, text: to === 'refunded'
        ? `Postage refund of $${(c.cents / 100).toFixed(2)} confirmed for ${which}. Recorded in Money.`
        : `Shippo turned down the refund for ${which}. The carrier scanned it, so that box may have gone out.` } }, { merge: true });
      if (to === 'denied') tx.set(oRef, { labelRefundDenied: { open: true, labelId: ref.id, txn, tracking: c.tracking || '', cents: c.cents, at } }, { merge: true });
    }
    return true;
  });
  return !!done;
}

// ── Carrier adjustments ──────────────────────────────────────────────────────
// Shippo bills a label's later corrections on its invoices: a surcharge, or an adjustment to the label's price. Each is
// matched to its label by the Shippo label it names; ones for labels bought elsewhere are left alone. Adjustments to a
// refund aren't read: refunds are booked from Shippo's own answer (followRefunds), and reading both could count one
// twice. Shippo's invoice items have no id of their own, so each is known by its invoice and what it says: the same item
// read again any morning is the same adjustment.
const CHARGE_TYPES = new Set(['LABEL_SURCHARGE', 'LABEL_PAYMENT_ADJUSTMENT']);
const INVOICE_DAYS = 120;

export type ChargeRun = { invoices: number; charges: number; cutOff: boolean };

/** The label record a Shippo label belongs to, made from its order for a label bought before records existed. */
async function recordFor(db: any, tenantId: string, txn: string): Promise<any | null> {
  const col = db.collection(labelsCol(tenantId));
  const hit = await col.where('boxTxns', 'array-contains', txn).limit(1).get();
  if (!hit.empty) return hit.docs[0].ref;
  const o = await db.collection(`tenants/${tenantId}/retailOrders`).where('shippoTransactionId', '==', txn).limit(1).get();
  if (o.empty) return null;
  const od = o.docs[0]; const order = od.data() || {};
  const id = labelKey(txn); const ref = db.doc(`${labelsCol(tenantId)}/${id}`);
  await db.runTransaction(async (tx: any) => {
    const s = await tx.get(ref); if (s.exists) return;
    tx.set(ref, await earlierRecord(db, tenantId, tx, order, od.id, id, new Date().toISOString()));
  });
  return ref;
}

/** One shop's Shippo invoices from the last few months, read for carrier adjustments on labels bought here, a few pages
 *  a morning, each morning picking up on the page it stopped at. An invoice still open is read round and round: it
 *  grows, and a new item can land on any page (newest first or last), so once it's read to the end it starts again from
 *  the first page. Once it closes it's read through once more from the first page, and then marked done. */
export async function importCarrierCharges(db: any, tenantId: string, apiKey: string, opts: { now?: number; deadline?: number; maxPages?: number } = {}): Promise<ChargeRun> {
  const now = opts.now ?? Date.now();
  const deadline = opts.deadline ?? Date.now() + 40000;
  const out: ChargeRun = { invoices: 0, charges: 0, cutOff: false };
  if (!apiKey) return out;
  let pagesLeft = opts.maxPages ?? 8;
  let invoices: any[] = [];
  try { invoices = (await get(apiKey, '/invoices?results=25&page=1'))?.results || []; } catch { return out; }
  invoices = invoices.filter((v: any) => v?.object_id && now - (Date.parse(String(v.object_created || '')) || now) <= INVOICE_DAYS * DAY)
    .sort((a: any, b: any) => (Date.parse(String(a.object_created || '')) || 0) - (Date.parse(String(b.object_created || '')) || 0));
  for (const inv of invoices) {
    if (pagesLeft <= 0 || Date.now() > deadline - 10000) { out.cutOff = true; break; }
    const mark = db.doc(`tenants/${tenantId}/shippoInvoices/${labelKey(inv.object_id)}`);
    const seen: any = (await mark.get().catch(() => null))?.data?.() || null;
    if (seen?.done === true) continue;
    out.invoices++;
    const closed = !!inv.invoice_closed || ['POSTED', 'PAID', 'CLOSED'].includes(String(inv.status || '').toUpperCase());
    // A place kept while it was still open says nothing about a closed invoice's pages: its last read starts at the top.
    let page = closed && seen?.closed !== true ? 1 : Math.max(1, Math.floor(Number(seen?.page) || 1)); let complete = false;
    while (pagesLeft > 0 && Date.now() <= deadline - 10000) {
      pagesLeft--;
      let data: any;
      try { data = await get(apiKey, `/invoice-items?invoiceObjectId=${encodeURIComponent(inv.object_id)}&results=100&page=${page}`); } catch { break; }
      const items: any[] = Array.isArray(data?.results) ? data.results : [];
      for (const it of items) {
        const type = String(it?.type || '').toUpperCase(); const txn = String(it?.transaction || '');
        if (!CHARGE_TYPES.has(type) || !txn || String(it?.currency || 'USD').toUpperCase() !== 'USD') continue;
        const cents = Math.round(parseFloat(String(it?.amount ?? '')) * 100);
        if (!Number.isFinite(cents) || cents === 0) continue;
        const description = String(it?.description || '').slice(0, 200);
        // Known by what it says, never by where it sits (pages shift as an open invoice grows). Two adjustments alike in
        // every way on one label and invoice count once: never twice.
        const key = createHash('sha1').update(`${inv.object_id}|${type}|${txn}|${cents}|${description}|${String(it?.object_created || '')}`).digest('hex').slice(0, 24);
        if (await addCharge(db, tenantId, txn, key, { type, cents, at: String(it?.object_created || inv.invoice_closed || inv.object_created || iso(now)), invoice: String(inv.invoice_number ?? inv.object_id), description })) out.charges++;
      }
      if (!data?.next) { complete = true; break; }
      page++;
    }
    if (!complete) out.cutOff = true;
    // Where to pick up: the next page not read yet (or the one that didn't load), or the first page once read to the end.
    await mark.set({ id: mark.id, invoice: String(inv.invoice_number ?? ''), readAt: iso(now), page: complete ? 1 : page, closed, done: complete && closed }, { merge: true }).catch(() => {});
  }
  return out;
}

/** One adjustment: into the books first (once, by its key), then onto the label record and the order, so a stop between
 *  the two is finished next time without writing the books twice. */
async function addCharge(db: any, tenantId: string, txn: string, key: string, c: { type: string; cents: number; at: string; invoice: string; description: string }): Promise<boolean> {
  const ref = await recordFor(db, tenantId, txn).catch(() => null);
  if (!ref) return false;
  const before: any = (await ref.get().catch(() => null))?.data?.() || null;
  if (!before || before.charges?.[key]) return false;
  const holder = String(before.orderId || '');
  if (!(await recordCarrierCharge(db, tenantId, { id: holder, orderNumber: before.orderNumber }, key, txn, c.cents, String(before.carrier || 'Carrier'), c.description))) return false;
  const now = new Date().toISOString();
  const added = await db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(ref)).data() || {};
    if (cur.charges?.[key]) return false;
    const oRef = holder ? db.doc(`tenants/${tenantId}/retailOrders/${holder}`) : null;
    const o: any = oRef ? (await tx.get(oRef)).data() || null : null;
    const slot = (cur.boxTxns || []).indexOf(txn);
    tx.set(ref, { charges: { [key]: { ...c, txn, slot: slot < 0 ? null : slot, recordedAt: now } }, chargesCents: (Number(cur.chargesCents) || 0) + c.cents, chargeOpen: true, updatedAt: now }, { merge: true });
    if (oRef && o) {
      const prev = o.labelCharge?.open === true ? Number(o.labelCharge.cents) || 0 : 0;
      tx.set(oRef, { labelCharge: { open: true, cents: prev + c.cents, at: now, labelId: ref.id } }, { merge: true });
      const ev = oRef.collection('events').doc(`label-charge-${key}`);
      const box = (cur.boxes || []).length > 1 && slot >= 0 ? ` on box ${slot + 1}` : '';
      tx.set(ev, { id: ev.id, type: 'note', at: now, actorId: 'shippo', actorName: 'Shippo', meta: { kind: 'label_charge', labelId: ref.id, text: `Carrier adjustment${box}: ${c.cents > 0 ? '+' : '−'}$${(Math.abs(c.cents) / 100).toFixed(2)}${c.description ? ` (${c.description})` : ''}. Recorded in Money.` } }, { merge: true });
    }
    return true;
  }).catch(() => false);
  return !!added;
}

/** For the order screens: "#1042". */
export const labelOrderNo = orderNo;

// ── One at a time ────────────────────────────────────────────────────────────
// Buying a label spends the shop's money and voiding one takes it off the order, so an order is claimed first: a
// second tap, a second device, the bulk buy, or a void (by hand, from an address change, or the morning check)
// reaching the same order is told someone is already at it, instead of buying a second label or voiding one that's
// being replaced. A claim left by a purchase or void that was cut off lapses after three minutes.
export const BUY_STALE_MS = 3 * 60_000;
export const BUYING = 'Someone is buying a label for this order right now. It shows here as soon as it’s bought.';
export const VOIDING = 'Someone is voiding this order’s label right now. Open it again in a minute.';

/** Claim the order for one purchase, or one void (`what`). `check` looks at the order as it is at the claim, so a label
 *  bought by someone else a moment ago is seen: it returns why nothing should be done, or nothing to go ahead. */
export async function claimLabelBuy(db: any, ref: any, by: string, now = Date.now(), check?: (cur: any) => string | null, what: 'buy' | 'void' = 'buy'): Promise<{ token: string } | { error: string; busy?: boolean }> {
  const token = `${now.toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const r = await db.runTransaction(async (tx: any) => {
    const c: any = (await tx.get(ref)).data() || {};
    const b = c.labelBuying;
    if (b && now - (Date.parse(String(b.at || '')) || 0) < BUY_STALE_MS) return { error: b.what === 'void' ? VOIDING : BUYING, busy: true };
    const why = check ? check(c) : null;
    if (why) return { error: why };
    tx.set(ref, { labelBuying: { at: iso(now), by: String(by || '').slice(0, 80), token, what } }, { merge: true });
    return { token };
  }).catch(() => ({ error: 'That didn’t go through. Try again in a minute.' }));
  return r;
}

export async function releaseLabelBuy(db: any, ref: any, token: string | null): Promise<void> {
  if (!token) return;
  await db.runTransaction(async (tx: any) => {
    const c: any = (await tx.get(ref)).data() || {};
    if (c.labelBuying?.token === token) tx.set(ref, { labelBuying: null }, { merge: true });
  }).catch(() => {});
}
